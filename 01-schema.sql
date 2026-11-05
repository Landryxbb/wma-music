-- =====================================================================
-- WMA MUSIC — base de données Supabase (v1)
-- Propriétaire : WMA UNITED AFRICA
-- À exécuter une seule fois dans Supabase > SQL Editor (projet existant de wmaua.com).
-- Les tables commencent par "music_" : elles ne touchent pas aux tables du site
-- (comptes artistes, soumissions, blog).
-- Ce script remplace le fichier wma-music-supabase.sql envoyé précédemment.
-- =====================================================================

-- ---------- Profils et rôles ----------
create table if not exists public.music_profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 2 and 40),
  role         text not null default 'user' check (role in ('user','admin')),
  created_at   timestamptz not null default now()
);

create or replace function public.music_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.music_profiles where id = auth.uid() and role = 'admin');
$$;

-- Profil créé automatiquement à chaque inscription (e-mail ou Google)
create or replace function public.music_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.music_profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), 40))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists music_on_auth_user_created on auth.users;
create trigger music_on_auth_user_created after insert on auth.users
  for each row execute function public.music_handle_new_user();

-- Comptes déjà existants (inscrits sur wmaua.com avant WMA MUSIC)
insert into public.music_profiles (id, display_name)
select id, left(coalesce(raw_user_meta_data->>'name', raw_user_meta_data->>'full_name', split_part(email,'@',1)), 40) from auth.users
on conflict (id) do nothing;

-- Personne ne peut se nommer administrateur soi-même depuis l'application.
-- (Le SQL Editor de Supabase, sans utilisateur connecté, reste autorisé.)
create or replace function public.music_protect_role()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.music_is_admin() then
    raise exception 'Seul un administrateur WMA peut changer un rôle';
  end if;
  return new;
end $$;
drop trigger if exists music_protect_role on public.music_profiles;
create trigger music_protect_role before update on public.music_profiles
  for each row execute function public.music_protect_role();

-- ---------- Catalogue ----------
-- Un document JSON par élément : artistes, albums, chansons publiées ou programmées,
-- brouillons/dépubliées (drafts), playlists officielles, catégories (meta/genres).
create table if not exists public.music_docs (
  kind       text not null check (kind in ('artists','albums','tracks','drafts','playlists','meta')),
  id         text not null check (char_length(id) between 1 and 80),
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (kind, id)
);
create or replace function public.music_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists music_docs_touch on public.music_docs;
create trigger music_docs_touch before update on public.music_docs for each row execute function public.music_touch();

-- Une chanson ne peut pas être publiée ou programmée sans droits de diffusion confirmés.
alter table public.music_docs drop constraint if exists music_tracks_need_rights;
alter table public.music_docs add constraint music_tracks_need_rights
  check (kind <> 'tracks' or coalesce(data->>'rights','') in ('confirmed','demo'));

-- ---------- Profils auditeurs : favoris, playlists, historique, écoutes ----------
create table if not exists public.music_people (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- Sécurité (Row Level Security) ----------
alter table public.music_profiles enable row level security;
alter table public.music_docs     enable row level security;
alter table public.music_people   enable row level security;

drop policy if exists "profil: lecture" on public.music_profiles;
create policy "profil: lecture" on public.music_profiles for select using (id = auth.uid() or public.music_is_admin());
drop policy if exists "profil: modification" on public.music_profiles;
create policy "profil: modification" on public.music_profiles for update using (id = auth.uid() or public.music_is_admin());

-- Catalogue : tout le monde lit ce qui est en ligne ; seuls les administrateurs lisent les brouillons et écrivent.
drop policy if exists "catalogue: lecture" on public.music_docs;
create policy "catalogue: lecture" on public.music_docs for select using (kind <> 'drafts' or public.music_is_admin());
drop policy if exists "catalogue: ajout admin" on public.music_docs;
create policy "catalogue: ajout admin" on public.music_docs for insert with check (public.music_is_admin());
drop policy if exists "catalogue: modif admin" on public.music_docs;
create policy "catalogue: modif admin" on public.music_docs for update using (public.music_is_admin()) with check (public.music_is_admin());
drop policy if exists "catalogue: suppression admin" on public.music_docs;
create policy "catalogue: suppression admin" on public.music_docs for delete using (public.music_is_admin());

-- Profils auditeurs : chacun écrit le sien ; les administrateurs lisent tout (statistiques).
drop policy if exists "auditeur: lecture" on public.music_people;
create policy "auditeur: lecture" on public.music_people for select using (user_id = auth.uid() or public.music_is_admin());
drop policy if exists "auditeur: création" on public.music_people;
create policy "auditeur: création" on public.music_people for insert with check (user_id = auth.uid());
drop policy if exists "auditeur: modification" on public.music_people;
create policy "auditeur: modification" on public.music_people for update using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select on public.music_docs to anon, authenticated;
grant insert, update, delete on public.music_docs to authenticated;
grant select, insert, update on public.music_people to authenticated;
grant select, update on public.music_profiles to authenticated;

-- ---------- Stockage des fichiers ----------
-- music-audio : PRIVÉ. L'application lit chaque titre par une adresse signée valable 6 h.
-- music-images : public (pochettes et photos).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('music-audio','music-audio', false, 52428800,
        array['audio/mpeg','audio/mp4','audio/x-m4a','audio/aac','audio/ogg','audio/webm','audio/flac','audio/wav','video/mp4','video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('music-images','music-images', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "music audio: lecture" on storage.objects;
create policy "music audio: lecture" on storage.objects for select to anon, authenticated using (bucket_id = 'music-audio');
drop policy if exists "music audio: ajout admin" on storage.objects;
create policy "music audio: ajout admin" on storage.objects for insert to authenticated with check (bucket_id = 'music-audio' and public.music_is_admin());
drop policy if exists "music audio: modif admin" on storage.objects;
create policy "music audio: modif admin" on storage.objects for update to authenticated using (bucket_id = 'music-audio' and public.music_is_admin());
drop policy if exists "music audio: suppression admin" on storage.objects;
create policy "music audio: suppression admin" on storage.objects for delete to authenticated using (bucket_id = 'music-audio' and public.music_is_admin());
drop policy if exists "music images: lecture" on storage.objects;
create policy "music images: lecture" on storage.objects for select using (bucket_id = 'music-images');
drop policy if exists "music images: ajout admin" on storage.objects;
create policy "music images: ajout admin" on storage.objects for insert to authenticated with check (bucket_id = 'music-images' and public.music_is_admin());
drop policy if exists "music images: modif admin" on storage.objects;
create policy "music images: modif admin" on storage.objects for update to authenticated using (bucket_id = 'music-images' and public.music_is_admin());
drop policy if exists "music images: suppression admin" on storage.objects;
create policy "music images: suppression admin" on storage.objects for delete to authenticated using (bucket_id = 'music-images' and public.music_is_admin());

-- ---------- Premier administrateur ----------
-- 1. Créez votre compte dans WMA MUSIC avec worldmusicactus@gmail.com (ou connectez-vous avec Google).
-- 2. Puis exécutez cette ligne ici, dans le SQL Editor :
-- update public.music_profiles set role = 'admin' where id = (select id from auth.users where email = 'worldmusicactus@gmail.com');
