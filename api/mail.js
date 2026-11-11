// WMA MUSIC — e-mails « nouvelle sortie » envoyés aux auditeurs qui ont accepté de les recevoir.
// Actions :
//   POST /api/mail?action=send    { kind:'track'|'album', id }  ou  { campaignId }   (administrateur WMA)
//   POST /api/mail?action=due                                  (administrateur WMA) : envoie ce qui est prévu / en pause
//   POST /api/mail?action=cancel  { campaignId }               (administrateur WMA)
//   GET  /api/mail?action=cron    Authorization: Bearer CRON_SECRET (facultatif, nécessite SUPABASE_SERVICE_ROLE_KEY)
//   GET|POST /api/mail?action=unsub&t=<jeton>                  (lien « Ne plus recevoir ces e-mails », sans connexion)
// Limites de l'offre gratuite Resend : 100 e-mails par jour, 3 000 par mois. On garde une marge :
//   MAIL_DAILY_LIMIT (90 par défaut) et MAIL_MONTHLY_LIMIT (2 900 par défaut). Au-delà, l'envoi se met en pause
//   et reprend le lendemain (bouton « Reprendre » dans l'admin, ou automatiquement avec le cron).
// Variables : RESEND_API_KEY, MAIL_FROM, SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL
//             (facultatif : SUPABASE_SERVICE_ROLE_KEY + CRON_SECRET pour l'envoi automatique le jour de la sortie)
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const env = () => {
  const e = process.env;
  return {
    resend: e.RESEND_API_KEY, from: e.MAIL_FROM, base: String(e.SUPABASE_URL || '').replace(/\/+$/, ''), anon: e.SUPABASE_ANON_KEY,
    service: e.SUPABASE_SERVICE_ROLE_KEY, cron: e.CRON_SECRET, site: String(e.SITE_URL || 'https://www.wmamusic.net').replace(/\/+$/, ''),
    daily: Math.max(1, Math.min(100, parseInt(e.MAIL_DAILY_LIMIT, 10) || 90)), monthly: Math.max(1, parseInt(e.MAIL_MONTHLY_LIMIT, 10) || 2900)
  };
};

// Appel REST Supabase, avec le jeton de l'administrateur (RLS) ou la clé serveur.
function client(E, token) {
  const key = token === 'service' ? E.service : null;
  const headers = { apikey: key || E.anon, Authorization: 'Bearer ' + (key || token), 'Content-Type': 'application/json' };
  return async (path, { method = 'GET', body, prefer, count } = {}) => {
    const h = { ...headers };
    if (prefer) h.Prefer = prefer;
    if (count) { h.Prefer = 'count=exact'; h.Range = '0-0'; }
    const r = await fetch(E.base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (count) { const cr = r.headers.get('content-range') || ''; return parseInt(cr.split('/')[1], 10) || 0; }
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { j = txt; }
    if (!r.ok) { const err = new Error((j && (j.message || j.error)) || ('HTTP ' + r.status)); err.status = r.status; throw err; }
    return j;
  };
}

const imgUrl = (E, v) => {
  if (!v || typeof v !== 'string' || v.startsWith('data:') || v.startsWith('blob:')) return '';
  if (/^https:\/\//.test(v)) return v;
  if (v.startsWith('/')) return E.site + v;
  if (/^img\//.test(v)) return `${E.base}/storage/v1/object/public/music-images/${v.split('/').map(encodeURIComponent).join('/')}`;
  return '';
};

// Informations de la sortie (chanson ou album) à partir du catalogue.
async function release(E, sb, kind, id) {
  const get = async (k, i) => { if (!i) return null; const j = await sb(`/rest/v1/music_docs?select=data&kind=eq.${k}&id=eq.${encodeURIComponent(i)}`); return (j[0] && j[0].data) || null; };
  const artistOf = async (aid, feats) => {
    const a = await get('artists', aid); const fs = [];
    for (const f of (feats || []).slice(0, 4)) { const x = await get('artists', f); if (x && x.name) fs.push(x.name); }
    const ft = fs.length > 1 ? fs.slice(0, -1).join(', ') + ' & ' + fs[fs.length - 1] : fs[0] || '';
    return { a, who: [a && a.name, ft].filter(Boolean).join(' ft. ') };
  };
  const artImg = a => a ? imgUrl(E, a.photoUrl) || imgUrl(E, a.photoId) || imgUrl(E, a.photo) : '';
  if (kind === 'track') {
    const t = await get('tracks', id);
    if (!t) return null;
    if (!(t.status === 'published' || t.status === 'scheduled')) return null;
    const { a, who } = await artistOf(t.artistId, t.featIds);
    const al = t.albumId ? await get('albums', t.albumId) : null;
    const at = t.status === 'scheduled' && t.publishAt ? Number(t.publishAt) : Date.now();
    return { title: t.title, artist: who, cover: imgUrl(E, t.coverId) || imgUrl(E, t.cover) || (al && (imgUrl(E, al.coverId) || imgUrl(E, al.cover))) || artImg(a), at, type: 'track' };
  }
  const al = await get('albums', id);
  if (!al) return null;
  const tr = await sb(`/rest/v1/music_docs?select=data&kind=eq.tracks&data->>albumId=eq.${encodeURIComponent(id)}`);
  const ts = (tr || []).map(x => x.data).filter(t => t.status === 'published' || t.status === 'scheduled');
  if (!ts.length) return null;
  const pub = ts.filter(t => t.status === 'published' || (t.publishAt && t.publishAt <= Date.now()));
  const at = pub.length ? Date.now() : Math.min(...ts.map(t => Number(t.publishAt) || Date.now()));
  const { a, who } = await artistOf(al.artistId, []);
  return { title: al.title, artist: who, cover: imgUrl(E, al.coverId) || imgUrl(E, al.cover) || artImg(a), at, type: String(al.type || 'Album'), count: ts.length };
}

function mailFor(E, c, r) {
  const fr = r.lang === 'fr', path = c.kind === 'album' ? 'album' : 'track';
  const link = `${E.site}/s/${path}/${encodeURIComponent(c.ref_id)}`;
  const unsub = `${E.site}/api/mail?action=unsub&t=${r.token}`;
  const isAlbum = c.kind === 'album';
  const what = fr ? (isAlbum ? 'Nouvel album' : 'Nouvelle sortie') : (isAlbum ? 'New album' : 'New release');
  const subject = `${what} : ${c.title}${c.artist ? ' – ' + c.artist : ''}`.replace(' : ', fr ? ' : ' : ': ');
  const hello = r.name ? (fr ? `Bonjour ${r.name},` : `Hello ${r.name},`) : (fr ? 'Bonjour,' : 'Hello,');
  const line = fr
    ? `${isAlbum ? 'L\'album' : 'La chanson'} « ${c.title} »${c.artist ? ' de ' + c.artist : ''} est disponible maintenant sur WMA MUSIC.`
    : `${isAlbum ? 'The album' : 'The song'} “${c.title}”${c.artist ? ' by ' + c.artist : ''} is out now on WMA MUSIC.`;
  const btn = fr ? '▶ Écouter sur WMA MUSIC' : '▶ Listen on WMA MUSIC';
  const why = fr ? 'Vous recevez cet e-mail car vous avez accepté d\'être prévenu des nouvelles sorties sur WMA MUSIC.' : 'You are receiving this email because you chose to hear about new releases on WMA MUSIC.';
  const stop = fr ? 'Ne plus recevoir ces e-mails' : 'Unsubscribe from these emails';
  const html = `<!doctype html><html lang="${fr ? 'fr' : 'en'}"><body style="margin:0;background:#0A0A0A">
<div style="background:#0A0A0A;padding:28px 14px;font-family:Arial,Helvetica,sans-serif">
 <div style="max-width:480px;margin:0 auto;background:#161618;border-radius:18px;overflow:hidden;color:#FFFFFF">
  <div style="padding:22px 26px 0;color:#FF7A1A;font-weight:800;font-size:18px;letter-spacing:.5px">WMA MUSIC</div>
  <div style="padding:8px 26px 0;color:#FF7A1A;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">${esc(what)}</div>
  ${c.cover ? `<div style="padding:18px 26px 0"><a href="${esc(link)}"><img src="${esc(c.cover)}" width="428" alt="${esc(c.title)}" style="display:block;width:100%;max-width:428px;height:auto;border-radius:12px;border:0"></a></div>` : ''}
  <div style="padding:20px 26px 6px"><div style="font-size:26px;font-weight:800;line-height:1.2">${esc(c.title)}</div>${c.artist ? `<div style="font-size:16px;color:#C9C9CE;margin-top:6px">${esc(c.artist)}</div>` : ''}</div>
  <p style="padding:0 26px;margin:14px 0 0;color:#D0D0D4;font-size:15px;line-height:1.6">${esc(hello)}<br>${esc(line)}</p>
  <div style="padding:22px 26px 28px"><a href="${esc(link)}" style="display:inline-block;background:#FF7A1A;color:#0A0A0A;text-decoration:none;font-weight:800;font-size:16px;padding:14px 26px;border-radius:999px">${esc(btn)}</a></div>
 </div>
 <p style="max-width:480px;margin:18px auto 0;color:#8E8E93;font-size:12px;line-height:1.6;text-align:center">${esc(why)}<br><a href="${esc(unsub)}" style="color:#8E8E93">${esc(stop)}</a><br>WMA UNITED AFRICA · WMA HUB</p>
</div></body></html>`;
  const text = `${hello}\n\n${line}\n\n${fr ? 'Écouter' : 'Listen'} : ${link}\n\n—\n${why}\n${stop} : ${unsub}\nWMA UNITED AFRICA · WMA HUB`;
  return { from: E.from, to: [r.email], subject, html, text, headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
}

// Envoie un lot pour un envoi, dans la limite du quota. Retourne l'envoi mis à jour.
async function process1(E, sb, c) {
  const patch = async p => { const j = await sb(`/rest/v1/music_mail_campaigns?id=eq.${c.id}`, { method: 'PATCH', body: { ...p, updated_at: new Date().toISOString() }, prefer: 'return=representation' }); return (j && j[0]) || { ...c, ...p }; };
  let sent = c.sent || 0, failed = c.failed || 0;
  for (let round = 0; round < 3; round++) {
    const since = n => new Date(Date.now() - n).toISOString();
    const d = await sb(`/rest/v1/music_mail_sends?select=user_id&status=eq.sent&sent_at=gt.${since(864e5)}`, { count: true });
    const m = await sb(`/rest/v1/music_mail_sends?select=user_id&status=eq.sent&sent_at=gt.${since(30 * 864e5)}`, { count: true });
    const room = Math.min(100, E.daily - d, E.monthly - m);
    const left = await sb('/rest/v1/rpc/music_mail_recipients', { method: 'POST', body: { p_campaign: c.id, p_limit: Math.max(1, room) } });
    if (!left || !left.length) return patch({ status: 'done', sent, failed, note: null });
    if (room <= 0) return patch({ status: 'paused', sent, failed, note: E.monthly - m <= 0 ? 'monthly_quota' : 'daily_quota' });
    const batch = left.slice(0, room);
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: 'Bearer ' + E.resend, 'Content-Type': 'application/json' }, body: JSON.stringify(batch.map(x => mailFor(E, c, x))) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return patch({ status: 'paused', sent, failed, note: 'resend: ' + String(j.message || j.name || r.status).slice(0, 200) });
    const rows = batch.map(x => ({ campaign_id: c.id, user_id: x.user_id, status: 'sent' }));
    await sb('/rest/v1/music_mail_sends', { method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates' });
    sent += rows.length;
    c = await patch({ status: 'sending', sent, failed, note: null });
  }
  return c;
}

async function runDue(E, sb) {
  const now = new Date().toISOString();
  const list = await sb(`/rest/v1/music_mail_campaigns?select=*&or=(and(status.eq.scheduled,send_at.lte.${now}),status.eq.sending,status.eq.paused)&order=send_at.asc&limit=10`);
  const out = [];
  for (const c of list || []) { const x = await process1(E, sb, c); out.push(x); if (x.status === 'paused' && /quota/.test(x.note || '')) break; }
  return out;
}

const page = (fr, ok) => `<!doctype html><html lang="${fr ? 'fr' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WMA MUSIC</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0A0A;color:#fff;font-family:system-ui,Arial,sans-serif;text-align:center;padding:24px}b{color:#FF7A1A}a{color:#FF7A1A}</style></head>
<body><div><p style="font-weight:800;font-size:20px"><b>WMA</b> MUSIC</p><h1 style="font-size:22px">${ok ? (fr ? 'Vous ne recevrez plus nos e-mails de nouvelles sorties.' : 'You will no longer receive our new-release emails.') : (fr ? 'Ce lien n\'est plus valide.' : 'This link is no longer valid.')}</h1>
<p style="color:#bbb">${fr ? 'Vous pouvez les réactiver à tout moment dans votre profil WMA MUSIC.' : 'You can turn them back on anytime in your WMA MUSIC profile.'}</p><p><a href="/">${fr ? 'Ouvrir WMA MUSIC' : 'Open WMA MUSIC'}</a></p></div></body></html>`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const E = env(), action = String((req.query && req.query.action) || '');
  if (!E.base || !E.anon) return res.status(501).json({ error: 'not_configured' });

  if (action === 'unsub') {
    const t = String((req.query && req.query.t) || '');
    const fr = /^fr/i.test(String(req.headers['accept-language'] || ''));
    let ok = false;
    if (UUID.test(t)) { try { ok = (await client(E, E.anon)('/rest/v1/rpc/music_mail_unsubscribe', { method: 'POST', body: { p_token: t } })) === true; } catch (e) { ok = false; } }
    if (req.method === 'POST') return res.status(200).json({ ok });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(page(fr, ok));
  }

  if (!E.resend || !E.from) return res.status(501).json({ error: 'mail_not_configured' });

  if (action === 'cron') {
    if (!E.cron || !E.service || String(req.headers.authorization || '') !== 'Bearer ' + E.cron) return res.status(401).json({ error: 'auth' });
    try { const out = await runDue(E, client(E, 'service')); return res.status(200).json({ ok: true, campaigns: out.map(c => ({ id: c.id, status: c.status, sent: c.sent })) }); }
    catch (e) { return res.status(500).json({ error: 'server', detail: e.message }); }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+$/.test(auth)) return res.status(401).json({ error: 'auth' });
  const token = auth.replace(/^Bearer\s+/, '');
  const sb = client(E, token);
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } } body = body || {};
  try {
    const user = await fetch(E.base + '/auth/v1/user', { headers: { apikey: E.anon, Authorization: 'Bearer ' + token } }).then(r => r.ok ? r.json() : null);
    if (!user || !user.id) return res.status(401).json({ error: 'auth' });
    const prof = await sb(`/rest/v1/music_profiles?select=role&id=eq.${encodeURIComponent(user.id)}`);
    if (!prof[0] || prof[0].role !== 'admin') return res.status(403).json({ error: 'forbidden' });

    if (action === 'due') { const out = await runDue(E, sb); return res.status(200).json({ ok: true, campaigns: out }); }

    if (action === 'cancel') {
      if (!UUID.test(String(body.campaignId || ''))) return res.status(400).json({ error: 'bad_request' });
      const j = await sb(`/rest/v1/music_mail_campaigns?id=eq.${body.campaignId}&status=in.(scheduled,paused,sending)`, { method: 'PATCH', body: { status: 'cancelled', updated_at: new Date().toISOString() }, prefer: 'return=representation' });
      return res.status(200).json({ ok: true, campaign: j && j[0] });
    }

    if (action === 'send') {
      let c;
      if (body.campaignId) {
        if (!UUID.test(String(body.campaignId))) return res.status(400).json({ error: 'bad_request' });
        c = (await sb(`/rest/v1/music_mail_campaigns?select=*&id=eq.${body.campaignId}`))[0];
        if (!c) return res.status(404).json({ error: 'not_found' });
        if (c.status === 'done' || c.status === 'cancelled') return res.status(409).json({ error: c.status, campaign: c });
        if (c.status === 'scheduled' && Date.parse(c.send_at) > Date.now()) return res.status(200).json({ ok: true, campaign: c });
      } else {
        const kind = body.kind === 'album' ? 'album' : body.kind === 'track' ? 'track' : '';
        const id = String(body.id || '');
        if (!kind || !/^[A-Za-z0-9_-]{2,80}$/.test(id)) return res.status(400).json({ error: 'bad_request' });
        const old = (await sb(`/rest/v1/music_mail_campaigns?select=*&kind=eq.${kind}&ref_id=eq.${encodeURIComponent(id)}`))[0];
        if (old && old.status !== 'cancelled') return res.status(409).json({ error: 'already_exists', campaign: old });
        const rel = await release(E, sb, kind, id);
        if (!rel) return res.status(409).json({ error: 'not_live' });
        const row = { kind, ref_id: id, title: String(rel.title || '').slice(0, 200), artist: String(rel.artist || '').slice(0, 200), cover: rel.cover || null,
          send_at: new Date(rel.at).toISOString(), status: 'scheduled', created_by: user.id, sent: 0, failed: 0, note: null, updated_at: new Date().toISOString() };
        const j = old
          ? await sb(`/rest/v1/music_mail_campaigns?id=eq.${old.id}`, { method: 'PATCH', body: row, prefer: 'return=representation' })
          : await sb('/rest/v1/music_mail_campaigns', { method: 'POST', body: row, prefer: 'return=representation' });
        c = j[0];
        if (rel.at > Date.now()) return res.status(200).json({ ok: true, campaign: c, scheduled: true });
      }
      c = await process1(E, sb, c);
      return res.status(200).json({ ok: true, campaign: c });
    }
    return res.status(400).json({ error: 'action' });
  } catch (e) {
    return res.status(e.status === 401 ? 401 : 500).json({ error: 'server', detail: String(e.message || e).slice(0, 300) });
  }
};
