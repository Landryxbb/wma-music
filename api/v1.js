// WMA MUSIC — API partenaires, lecture seule (distributeurs, médias, plateformes).
// Adresse : https://www.wmamusic.net/api/v1/<ressource>   (réécrite vers /api/v1?p=<ressource>)
// Clé : en-tête  X-API-Key: wma_…   (ou Authorization: Bearer wma_…). Les clés se créent dans WMA ADMIN › API.
// Ressources : tracks, tracks/{id}, artists, artists/{id}, albums, albums/{id}, playlists, playlists/{id}, new-releases
// Ne renvoie JAMAIS les fichiers audio ni aucune donnée d'auditeur : seulement les informations publiques du catalogue
// et des liens vers WMA MUSIC.
// Variables : SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL
const crypto = require('crypto');
let CACHE = { at: 0, data: null };

const env = () => ({ base: String(process.env.SUPABASE_URL || '').replace(/\/+$/, ''), anon: process.env.SUPABASE_ANON_KEY || '', site: String(process.env.SITE_URL || 'https://www.wmamusic.net').replace(/\/+$/, '') });
const sb = async (E, path, opt = {}) => {
  const r = await fetch(E.base + path, { method: opt.method || 'GET', headers: { apikey: E.anon, Authorization: 'Bearer ' + E.anon, 'Content-Type': 'application/json' }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  if (!r.ok) { const e = new Error('upstream ' + r.status); e.status = 502; throw e; }
  return r.json();
};
const img = (E, v) => {
  if (!v || typeof v !== 'string' || v.startsWith('data:') || v.startsWith('blob:')) return null;
  if (/^https:\/\//.test(v)) return v;
  if (v.startsWith('/')) return E.site + v;
  if (/^img\//.test(v)) return `${E.base}/storage/v1/object/public/music-images/${v.split('/').map(encodeURIComponent).join('/')}`;
  return null;
};
const iso = ms => (ms && isFinite(ms)) ? new Date(Number(ms)).toISOString() : null;

async function catalogue(E) {
  if (CACHE.data && Date.now() - CACHE.at < 60e3) return CACHE.data;
  let rows = [];
  for (let off = 0; off < 20000; off += 1000) {
    const part = await sb(E, `/rest/v1/music_docs?select=id,kind,data&kind=in.(tracks,artists,albums,playlists)&order=id.asc&offset=${off}&limit=1000`);
    rows = rows.concat(part || []); if (!part || part.length < 1000) break;
  }
  const by = { tracks: {}, artists: {}, albums: {}, playlists: {} };
  for (const r of rows || []) if (by[r.kind]) by[r.kind][r.id] = { id: r.id, ...(r.data || {}) };
  CACHE = { at: Date.now(), data: by };
  return by;
}
const relAt = t => Number(t.status === 'scheduled' ? t.publishAt : (t.publishedAt || t.publishAt || t.createdAt)) || 0;
const isLive = t => !!t && !t.demo && (t.status === 'published' || (t.status === 'scheduled' && t.publishAt && Number(t.publishAt) <= Date.now()));

function shape(E, C) {
  const A = id => { const a = C.artists[id]; return a ? { id: a.id, name: a.name } : null; };
  const track = t => {
    const al = t.albumId && C.albums[t.albumId];
    const a = C.artists[t.artistId] || {};
    const at = relAt(t);
    const o = {
      id: t.id, title: t.title || '', artist: A(t.artistId), featured: (t.featIds || []).map(A).filter(Boolean),
      album: al ? { id: al.id, title: al.title, type: al.type || 'Album' } : null,
      genre: t.genre || null, release_date: t.releaseDate || (at ? iso(at).slice(0, 10) : null), released_at: iso(at),
      duration_seconds: t.duration ? Math.round(t.duration) : null,
      cover_url: img(E, t.coverId) || img(E, t.coverUrl) || img(E, t.cover) || (al && (img(E, al.coverId) || img(E, al.coverUrl) || img(E, al.cover))) || img(E, a.photoUrl) || null,
      url: `${E.site}/s/track/${encodeURIComponent(t.id)}`
    };
    for (const [k, f] of [['isrc', 'isrc'], ['label', 'label'], ['producer', 'producer'], ['songwriter', 'writer'], ['songwriter', 'songwriter']]) if (t[f] && typeof t[f] === 'string' && !o[k]) o[k] = t[f];
    return o;
  };
  const liveTracks = () => Object.values(C.tracks).filter(isLive);
  const artist = (a, full) => {
    const tr = liveTracks().filter(t => t.artistId === a.id || (t.featIds || []).includes(a.id));
    const o = { id: a.id, name: a.name || '', country: a.country || null, verified: !!a.verified, photo_url: img(E, a.photoUrl) || img(E, a.photoId) || img(E, a.photo) || null,
      bio: a.bio || null, tracks_count: tr.length, url: `${E.site}/s/artist/${encodeURIComponent(a.id)}` };
    const links = {}; for (const k of ['website', 'youtube', 'instagram', 'tiktok', 'facebook', 'x', 'twitter', 'spotify', 'apple', 'audiomack', 'boomplay']) if (typeof a[k] === 'string' && /^https?:\/\//.test(a[k])) links[k] = a[k];
    if (Object.keys(links).length) o.links = links;
    if (full) o.tracks = tr.sort((x, y) => relAt(y) - relAt(x)).map(track);
    return o;
  };
  const album = (al, full) => {
    const tr = liveTracks().filter(t => t.albumId === al.id).sort((x, y) => (x.trackNo || 0) - (y.trackNo || 0) || relAt(x) - relAt(y));
    const o = { id: al.id, title: al.title || '', type: al.type || 'Album', artist: A(al.artistId), release_date: al.date || (tr[0] ? track(tr[0]).release_date : null),
      cover_url: img(E, al.coverId) || img(E, al.coverUrl) || img(E, al.cover) || null, tracks_count: tr.length, url: `${E.site}/s/album/${encodeURIComponent(al.id)}` };
    if (full) o.tracks = tr.map(track);
    return o;
  };
  const playlist = (p, full) => {
    const tr = (p.trackIds || []).map(id => C.tracks[id]).filter(isLive);
    const o = { id: p.id, name: p.name || '', description: p.desc || null, cover_url: img(E, p.coverId) || img(E, p.coverUrl) || img(E, p.cover) || null, tracks_count: tr.length, url: `${E.site}/s/playlist/${encodeURIComponent(p.id)}` };
    if (full) o.tracks = tr.map(track);
    return o;
  };
  return { track, artist, album, playlist, liveTracks };
}

const ROUTES = ['tracks', 'tracks/{id}', 'artists', 'artists/{id}', 'albums', 'albums/{id}', 'playlists', 'playlists/{id}', 'new-releases'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Only GET is supported.' } });
  const E = env();
  if (!E.base || !E.anon) return res.status(503).json({ error: { code: 'not_configured', message: 'API not configured.' } });
  const q = req.query || {};
  const p = String(q.p || '').replace(/^\/+|\/+$/g, '');
  if (!p) return res.status(200).json({ name: 'WMA MUSIC API', version: 'v1', docs: E.site + '/api-docs', auth: 'X-API-Key header', resources: ROUTES.map(r => '/api/v1/' + r) });

  const raw = String(req.headers['x-api-key'] || '').trim() || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!/^wma_[A-Za-z0-9]{20,80}$/.test(raw)) return res.status(401).json({ error: { code: 'missing_api_key', message: 'Send your key in the X-API-Key header.' } });
  let chk = 'invalid';
  try { chk = await sb(E, '/rest/v1/rpc/music_api_key_check', { method: 'POST', body: { p_hash: crypto.createHash('sha256').update(raw).digest('hex') } }); }
  catch (e) { return res.status(503).json({ error: { code: 'unavailable', message: 'Please try again later.' } }); }
  if (chk === 'limit') return res.status(429).json({ error: { code: 'rate_limited', message: 'Hourly request limit reached for this key.' } });
  if (chk !== 'ok') return res.status(401).json({ error: { code: chk === 'revoked' ? 'revoked_api_key' : 'invalid_api_key', message: 'This API key is not valid.' } });

  try {
    const C = await catalogue(E), S = shape(E, C);
    const [res0, id, extra] = p.split('/');
    if (extra !== undefined) return res.status(404).json({ error: { code: 'not_found', message: 'Unknown resource.' } });
    const limit = Math.max(1, Math.min(100, parseInt(q.limit, 10) || 50)), offset = Math.max(0, parseInt(q.offset, 10) || 0);
    const sinceRaw = q.since ? (/^\d+$/.test(String(q.since)) ? Number(q.since) : Date.parse(String(q.since))) : null;
    if (q.since && !isFinite(sinceRaw)) return res.status(400).json({ error: { code: 'bad_since', message: 'since must be an ISO date or a timestamp in milliseconds.' } });
    const page = list => { res.setHeader('Cache-Control', 'private, max-age=60'); return res.status(200).json({ data: list.slice(offset, offset + limit), total: list.length, limit, offset }); };
    const one = o => { res.setHeader('Cache-Control', 'private, max-age=60'); return o ? res.status(200).json({ data: o }) : res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } }); };
    const valid = s => /^[A-Za-z0-9_-]{1,80}$/.test(s || '');

    if (res0 === 'tracks' || res0 === 'new-releases') {
      if (id !== undefined) { if (res0 !== 'tracks' || !valid(id)) return one(null); const t = C.tracks[id]; return one(isLive(t) ? S.track(t) : null); }
      let l = S.liveTracks();
      const since = res0 === 'new-releases' ? (sinceRaw || Date.now() - 7 * 864e5) : sinceRaw;
      if (since) l = l.filter(t => relAt(t) >= since);
      if (q.artist) l = l.filter(t => t.artistId === q.artist || (t.featIds || []).includes(q.artist));
      if (q.genre) l = l.filter(t => String(t.genre || '').toLowerCase() === String(q.genre).toLowerCase());
      if (q.q) { const s = String(q.q).toLowerCase(); l = l.filter(t => String(t.title || '').toLowerCase().includes(s)); }
      return page(l.sort((a, b) => relAt(b) - relAt(a)).map(S.track));
    }
    if (res0 === 'artists') {
      if (id !== undefined) { const a = valid(id) && C.artists[id]; return one(a ? S.artist(a, true) : null); }
      const live = S.liveTracks(); const has = new Set(live.flatMap(t => [t.artistId, ...(t.featIds || [])]));
      return page(Object.values(C.artists).filter(a => has.has(a.id)).sort((a, b) => String(a.name).localeCompare(String(b.name))).map(a => S.artist(a, false)));
    }
    if (res0 === 'albums') {
      if (id !== undefined) { const al = valid(id) && C.albums[id]; const o = al && S.album(al, true); return one(o && o.tracks_count ? o : null); }
      return page(Object.values(C.albums).map(al => S.album(al, false)).filter(a => a.tracks_count).sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || ''))));
    }
    if (res0 === 'playlists') {
      if (id !== undefined) { const pl = valid(id) && C.playlists[id]; return one(pl ? S.playlist(pl, true) : null); }
      return page(Object.values(C.playlists).map(pl => S.playlist(pl, false)));
    }
    return res.status(404).json({ error: { code: 'not_found', message: 'Unknown resource. See ' + E.site + '/api-docs' } });
  } catch (e) {
    return res.status(e.status || 500).json({ error: { code: 'server_error', message: 'Please try again later.' } });
  }
};
