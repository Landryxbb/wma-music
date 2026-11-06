// WMA MUSIC — page d'aperçu pour les liens partagés (WhatsApp, Facebook, X, Telegram…).
// Les réseaux sociaux ne lisent pas l'application (JavaScript) : cette fonction leur renvoie
// le titre, la description et l'image (pochette ou photo de l'artiste), puis renvoie
// les visiteurs vers la bonne page de l'application.
// Adresse : /s/<type>/<id>  (type = track | artist | album | playlist | video)
// Variables Vercel utilisées : SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL (facultatif)
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KINDS = { track: 'tracks', artist: 'artists', album: 'albums', playlist: 'playlists', video: 'videos' };

module.exports = async (req, res) => {
  const site = (process.env.SITE_URL || ('https://' + (req.headers.host || 'www.wmamusic.net'))).replace(/\/+$/, '');
  const k = String((req.query && req.query.k) || '').toLowerCase();
  const id = String((req.query && req.query.id) || '');
  const ok = KINDS[k] && /^[A-Za-z0-9_-]{2,80}$/.test(id);
  const appUrl = ok ? `${site}/#${k}-${id}` : `${site}/`;
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_ANON_KEY || '';
  const img = v => {
    if (!v || typeof v !== 'string' || v.startsWith('data:') || v.startsWith('blob:')) return '';
    if (/^https:\/\//.test(v)) return v;
    if (v.startsWith('/')) return site + v;
    if (/^img\//.test(v) && base) return `${base}/storage/v1/object/public/music-images/${v.split('/').map(encodeURIComponent).join('/')}`;
    return '';
  };
  const get = async (kind, docId) => {
    if (!base || !key || !docId) return null;
    try {
      const r = await fetch(`${base}/rest/v1/music_docs?select=data&kind=eq.${kind}&id=eq.${encodeURIComponent(docId)}`, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
      if (!r.ok) return null; const j = await r.json(); return (j[0] && j[0].data) || null;
    } catch (e) { return null; }
  };
  const live = t => t && (t.status === 'published' || (t.status === 'scheduled' && t.publishAt && t.publishAt <= Date.now()));
  const artistImg = a => a ? img(a.photoUrl) || img(a.photoId) || img(a.photo) || img(a.coverId) || img(a.coverUrl) : '';

  let title = 'WMA MUSIC', desc = 'Your music. Your Africa. Your sound. Free African music streaming.', image = '', type = 'website', alt = 'WMA MUSIC';
  if (ok) {
    const d = await get(KINDS[k], id);
    if (k === 'track' && live(d)) {
      const a = await get('artists', d.artistId);
      const feats = [];
      for (const f of (d.featIds || []).slice(0, 3)) { const x = await get('artists', f); if (x) feats.push(x.name); }
      const who = [a && a.name, ...feats].filter(Boolean).join(' ft. ');
      const al = d.albumId ? await get('albums', d.albumId) : null;
      title = `${d.title}${who ? ' — ' + who : ''}`;
      desc = `Listen to “${d.title}”${who ? ' by ' + who : ''} on WMA MUSIC 🎧`;
      image = img(d.coverId) || img(d.cover) || (al && (img(al.coverId) || img(al.cover))) || artistImg(a);
      type = 'music.song'; alt = `Cover of ${d.title}`;
    } else if (k === 'artist' && d) {
      title = `${d.name} on WMA MUSIC`;
      desc = d.bio ? String(d.bio).replace(/\s+/g, ' ').slice(0, 180) : `Discover ${d.name}${d.country ? ' (' + d.country + ')' : ''} on WMA MUSIC 🎧`;
      image = artistImg(d); type = 'profile'; alt = d.name;
    } else if (k === 'album' && d) {
      const a = await get('artists', d.artistId);
      title = `${d.title}${a ? ' — ' + a.name : ''}`;
      desc = `Listen to the ${String(d.type || 'album').toLowerCase()} “${d.title}”${a ? ' by ' + a.name : ''} on WMA MUSIC 🎧`;
      image = img(d.coverId) || img(d.cover) || artistImg(a); type = 'music.album'; alt = `Cover of ${d.title}`;
    } else if (k === 'playlist' && d && d.official) {
      title = `${d.name} — WMA MUSIC playlist`;
      desc = d.description ? String(d.description).slice(0, 180) : `Listen to the “${d.name}” playlist on WMA MUSIC 🎧`;
      let a = d.coverArtist ? await get('artists', d.coverArtist) : null;
      image = img(d.coverId) || img(d.cover) || artistImg(a); type = 'music.playlist'; alt = d.name;
    } else if (k === 'video' && d && d.status !== 'draft') {
      const a = await get('artists', d.artistId);
      const yt = d.youtubeId ? [0, d.youtubeId] : String(d.youtube || d.url || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
      title = `${d.title}${a ? ' — ' + a.name : ''}`;
      desc = `Watch “${d.title}”${a ? ' by ' + a.name : ''} on WMA MUSIC 🎬`;
      image = img(d.thumbId) || img(d.thumb) || (yt ? `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg` : '') || artistImg(a); type = 'video.other'; alt = d.title;
    }
  }
  if (!image) image = `${site}/icon-512.png`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(appUrl)}">
<meta property="og:site_name" content="WMA MUSIC">
<meta property="og:type" content="${esc(type)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(site + (req.url || '/'))}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:alt" content="${esc(alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="#0A0A0A">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0A0A;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px}a{color:#FF7A1A}img{width:180px;height:180px;object-fit:cover;border-radius:16px}</style>
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head><body><div><img src="${esc(image)}" alt=""><p><b>${esc(title)}</b></p><p><a href="${esc(appUrl)}">Open in WMA MUSIC</a></p></div></body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  res.status(200).send(html);
};
