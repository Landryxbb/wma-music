-- =====================================================================
-- WMA MUSIC — mise à jour « plateforme » (v2)
-- Profils artistes pro, playlists intelligentes, WMA Artist Dashboard,
-- clips vidéo et sessions live, pre-save.
-- À exécuter UNE fois dans Supabase > SQL Editor, après 01, 02 et 03.
-- Ne supprime rien : ajoute des colonnes, des fonctions et un espace de stockage.
-- =====================================================================

-- ---------- 1. Accès « WMA Artist Dashboard » ----------
-- Liste des artistes (identifiants du catalogue) qu'un compte peut suivre dans le dashboard.
alter table public.music_profiles add column if not exists artist_ids text[] not null default '{}';

-- Seul un administrateur peut changer un rôle ou un accès artiste.
create or replace function public.music_protect_role()
returns trigger language plpgsql as $$
begin
  if (new.role is distinct from old.role or new.artist_ids is distinct from old.artist_ids)
     and auth.uid() is not null and not public.music_is_admin() then
    raise exception 'Seul un administrateur WMA peut changer un rôle ou un accès artiste';
  end if;
  return new;
end $$;

grant update (display_name, role, artist_ids) on public.music_profiles to authenticated;

-- ---------- 2. Vidéos (clips officiels et sessions live) ----------
alter table public.music_docs drop constraint if exists music_docs_kind_check;
alter table public.music_docs add constraint music_docs_kind_check
  check (kind in ('artists','albums','tracks','drafts','playlists','meta','videos','videodrafts'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('music-video','music-video', true, 52428800, array['video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "music video: lecture" on storage.objects;
create policy "music video: lecture" on storage.objects for select using (bucket_id = 'music-video');
drop policy if exists "music video: ajout admin" on storage.objects;
create policy "music video: ajout admin" on storage.objects for insert to authenticated with check (bucket_id = 'music-video' and public.music_is_admin());
drop policy if exists "music video: modif admin" on storage.objects;
create policy "music video: modif admin" on storage.objects for update to authenticated using (bucket_id = 'music-video' and public.music_is_admin());
drop policy if exists "music video: suppression admin" on storage.objects;
create policy "music video: suppression admin" on storage.objects for delete to authenticated using (bucket_id = 'music-video' and public.music_is_admin());

-- Les vidéos non publiées (videodrafts) ne sont lisibles que par les administrateurs.
drop policy if exists "catalogue: lecture" on public.music_docs;
create policy "catalogue: lecture" on public.music_docs for select
  using (kind not in ('drafts','videodrafts') or public.music_is_admin());

-- ---------- 3. Statistiques publiques (chiffres réels, agrégés, anonymes) ----------
-- Calculées à partir des profils auditeurs (music_people). Aucune donnée personnelle n'est exposée :
-- uniquement des totaux par chanson, artiste ou vidéo.
create or replace function public.music_public_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  with
  l  as (select p.user_id, e.key as tid, coalesce((e.value->>'n')::int,0) as n
         from public.music_people p, jsonb_each(case when jsonb_typeof(p.data->'listens')='object' then p.data->'listens' else '{}'::jsonb end) e),
  lg as (select x.t as tid, x.ts from public.music_people p,
         jsonb_to_recordset(case when jsonb_typeof(p.data->'log')='array' then p.data->'log' else '[]'::jsonb end) as x(t text, ts bigint)),
  f  as (select v as tid from public.music_people p, jsonb_array_elements_text(case when jsonb_typeof(p.data->'favs')='array' then p.data->'favs' else '[]'::jsonb end) v),
  fo as (select v as aid from public.music_people p, jsonb_array_elements_text(case when jsonb_typeof(p.data->'follows')='array' then p.data->'follows' else '[]'::jsonb end) v),
  ps as (select v as tid from public.music_people p, jsonb_array_elements_text(case when jsonb_typeof(p.data->'presaves')='array' then p.data->'presaves' else '[]'::jsonb end) v),
  vw as (select e.key as vid, coalesce((e.value->>'n')::int,0) as n
         from public.music_people p, jsonb_each(case when jsonb_typeof(p.data->'views')='object' then p.data->'views' else '{}'::jsonb end) e)
  select jsonb_build_object(
    'plays',     (select coalesce(jsonb_object_agg(tid, s), '{}') from (select tid, sum(n) s from l group by tid) a),
    'listeners', (select coalesce(jsonb_object_agg(tid, c), '{}') from (select tid, count(distinct user_id) c from l where n > 0 group by tid) a),
    'recent',    (select coalesce(jsonb_object_agg(tid, c), '{}') from (select tid, count(*) c from lg where ts > (extract(epoch from now())*1000 - 30::bigint*86400000) group by tid) a),
    'favs',      (select coalesce(jsonb_object_agg(tid, c), '{}') from (select tid, count(*) c from f group by tid) a),
    'followers', (select coalesce(jsonb_object_agg(aid, c), '{}') from (select aid, count(*) c from fo group by aid) a),
    'presaves',  (select coalesce(jsonb_object_agg(tid, c), '{}') from (select tid, count(*) c from ps group by tid) a),
    'views',     (select coalesce(jsonb_object_agg(vid, s), '{}') from (select vid, sum(n) s from vw group by vid) a),
    'at',        floor(extract(epoch from now())*1000)
  );
$$;
revoke all on function public.music_public_stats() from public;
grant execute on function public.music_public_stats() to anon, authenticated;

-- ---------- 4. Rapport « WMA Artist Dashboard » ----------
-- Accessible uniquement aux administrateurs et aux comptes autorisés pour cet artiste.
create or replace function public.music_artist_report(p_artist text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  allowed boolean;
  tids text[];
  res jsonb;
begin
  select public.music_is_admin()
         or exists (select 1 from public.music_profiles where id = auth.uid() and p_artist = any(artist_ids))
    into allowed;
  if not allowed then
    raise exception 'Accès refusé au tableau de bord de cet artiste' using errcode = '42501';
  end if;

  select coalesce(array_agg(id), '{}') into tids
  from public.music_docs
  where kind in ('tracks','drafts')
    and (data->>'artistId' = p_artist
         or (jsonb_typeof(data->'featIds') = 'array' and data->'featIds' ? p_artist));

  with
  l  as (select p.user_id, upper(coalesce(nullif(p.data->>'country',''),'XX')) as country, e.key as tid, coalesce((e.value->>'n')::int,0) as n
         from public.music_people p, jsonb_each(case when jsonb_typeof(p.data->'listens')='object' then p.data->'listens' else '{}'::jsonb end) e
         where e.key = any(tids)),
  lg as (select x.t as tid, x.ts from public.music_people p,
         jsonb_to_recordset(case when jsonb_typeof(p.data->'log')='array' then p.data->'log' else '[]'::jsonb end) as x(t text, ts bigint)
         where x.t = any(tids)),
  f  as (select v as tid from public.music_people p, jsonb_array_elements_text(case when jsonb_typeof(p.data->'favs')='array' then p.data->'favs' else '[]'::jsonb end) v where v = any(tids)),
  ps as (select v as tid from public.music_people p, jsonb_array_elements_text(case when jsonb_typeof(p.data->'presaves')='array' then p.data->'presaves' else '[]'::jsonb end) v where v = any(tids))
  select jsonb_build_object(
    'artist',          p_artist,
    'trackIds',        to_jsonb(tids),
    'streams',         (select coalesce(sum(n),0) from l),
    'listeners',       (select count(distinct user_id) from l where n > 0),
    'followers',       (select count(*) from public.music_people p where jsonb_typeof(p.data->'follows')='array' and p.data->'follows' ? p_artist),
    'tracks',          (select coalesce(jsonb_object_agg(tid, jsonb_build_object('streams', s, 'listeners', c)), '{}')
                        from (select tid, sum(n) s, count(distinct user_id) filter (where n > 0) c from l group by tid) a),
    'favs',            (select coalesce(jsonb_object_agg(tid, c), '{}') from (select tid, count(*) c from f group by tid) a),
    'presaves',        (select coalesce(jsonb_object_agg(tid, c), '{}') from (select tid, count(*) c from ps group by tid) a),
    'countries',       (select coalesce(jsonb_object_agg(country, jsonb_build_object('streams', s, 'listeners', c)), '{}')
                        from (select country, sum(n) s, count(distinct user_id) filter (where n > 0) c from l group by country) a),
    'days',            (select coalesce(jsonb_object_agg(d, c), '{}')
                        from (select to_char(to_timestamp(ts/1000.0) at time zone 'UTC', 'YYYY-MM-DD') d, count(*) c
                              from lg where ts > (extract(epoch from now())*1000 - 90::bigint*86400000) group by 1) a),
    'at',              floor(extract(epoch from now())*1000)
  ) into res;
  return res;
end $$;
revoke all on function public.music_artist_report(text) from public;
grant execute on function public.music_artist_report(text) to authenticated;

-- ---------- 5. Catégories de départ et playlists ----------
-- Ajoute Soukous et Congolese Music aux catégories existantes (sans doublon).
update public.music_docs
set data = jsonb_set(data, '{list}', (
  select to_jsonb(array_agg(distinct g)) from (
    select jsonb_array_elements_text(data->'list') g
    union select 'Soukous'
  ) s))
where kind = 'meta' and id = 'genres';
