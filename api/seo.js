// WMA MUSIC — pages lisibles par Google (référencement).
// L'application utilise des adresses avec « # » que Google ne voit pas comme des pages.
// Cette fonction crée une vraie page HTML par artiste, chanson et album publiés,
// avec un bouton « Listen on WMA MUSIC » qui ouvre la page correspondante dans l'application.
//   /artist/<nom>      /song/<titre>-<artiste>      /album/<titre>-<artiste>
//   /sitemap-music.xml : liste de toutes ces pages pour Google
// Aucune donnée privée et aucun fichier audio : seulement titre, artiste, pochette, date, genre.
// Variables Vercel utilisées : SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL (facultatif)
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

let CACHE = { at: 0, data: null };
async function loadAll(base, key) {
  if (CACHE.data && Date.now() - CACHE.at < 5 * 60 * 1000) return CACHE.data;
  const r = await fetch(`${base}/rest/v1/music_docs?select=id,kind,data&kind=in.(tracks,albums,artists)&limit=20000`, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error('supabase ' + r.status);
  const rows = await r.json();
  CACHE = { at: Date.now(), data: build(rows) };
  return CACHE.data;
}

// Même règle que l'application et les pages de partage : publiée, ou programmée et déjà sortie.
const live = t => t && !t.demo && (t.status === 'published' || (t.status === 'scheduled' && t.publishAt && t.publishAt <= Date.now()));

function build(rows) {
  const A = new Map(), T = [], AL = new Map();
  for (const r of rows) {
    const d = Object.assign({}, r.data || {}, { id: r.id });
    if (r.kind === 'artists') A.set(r.id, d); else if (r.kind === 'albums') AL.set(r.id, d); else if (r.kind === 'tracks' && live(d)) T.push(d);
  }
  T.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const byArtist = new Map(), byAlbum = new Map();
  for (const t of T) {
    for (const id of [t.artistId, ...(t.featIds || [])]) { if (!A.has(id)) continue; if (!byArtist.has(id)) byArtist.set(id, []); if (!byArtist.get(id).includes(t)) byArtist.get(id).push(t); }
    if (t.albumId && AL.has(t.albumId)) { if (!byAlbum.has(t.albumId)) byAlbum.set(t.albumId, []); byAlbum.get(t.albumId).push(t); }
  }
  // Seuls les artistes et albums qui ont au moins une chanson en ligne ont une page.
  const artists = [...A.values()].filter(a => a.name && byArtist.has(a.id)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const albums = [...AL.values()].filter(a => a.title && byAlbum.has(a.id)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  // Adresses lisibles et stables ; en cas de doublon, l'identifiant est ajouté.
  const slugs = { artist: new Map(), song: new Map(), album: new Map() }, ids = { artist: new Map(), song: new Map(), album: new Map() };
  const put = (k, base, id) => { let s = base || id; if (slugs[k].has(s)) s = (base ? base + '-' : '') + slugify(id); slugs[k].set(s, id); ids[k].set(id, s); };
  for (const a of artists) put('artist', slugify(a.name), a.id);
  for (const t of T) { const a = A.get(t.artistId); put('song', slugify(t.title + (a ? ' ' + a.name : '')), t.id); }
  for (const al of albums) { const a = A.get(al.artistId); put('album', slugify(al.title + (a ? ' ' + a.name : '')), al.id); }
  return { A, T, AL, artists, albums, byArtist, byAlbum, slugs, ids, tById: new Map(T.map(t => [t.id, t])) };
}

const dateOf = t => { const d = t.releaseDate || t.date || (t.publishedAt ? new Date(t.publishedAt).toISOString().slice(0, 10) : ''); return /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : ''; };
const niceDate = d => { if (!d) return ''; const [y, m, j] = d.split('-').map(Number); return `${j} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`; };
const isoDur = s => { s = Math.round(Number(s) || 0); return s > 0 ? `PT${Math.floor(s / 60)}M${s % 60}S` : ''; };
const mmss = s => { s = Math.round(Number(s) || 0); return s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : ''; };

module.exports = async (req, res) => {
  const site = (process.env.SITE_URL || 'https://www.wmamusic.net').replace(/\/+$/, '');
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_ANON_KEY || '';
  const q = req.query || {};
  const img = v => {
    if (!v || typeof v !== 'string' || v.startsWith('data:') || v.startsWith('blob:')) return '';
    if (/^https:\/\//.test(v)) return v;
    if (v.startsWith('/')) return site + v;
    if (/^img\//.test(v) && base) return `${base}/storage/v1/object/public/music-images/${v.split('/').map(encodeURIComponent).join('/')}`;
    return '';
  };
  const artistImg = a => a ? img(a.photoUrl) || img(a.photoId) || img(a.photo) || img(a.coverId) || img(a.coverUrl) : '';
  const sendHtml = (code, html) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', code === 200 ? 'public, max-age=0, s-maxage=900, stale-while-revalidate=86400' : 'public, max-age=0, s-maxage=60'); res.status(code).send(html); };

  let D;
  try { if (!base || !key) throw new Error('config'); D = await loadAll(base, key); }
  catch (e) { console.error('seo', e.message); return sendHtml(503, page({ site, title: 'WMA MUSIC', desc: '', body: '<p class="muted">WMA MUSIC is temporarily unavailable. Please try again in a moment.</p>', noindex: true })); }

  const U = (k, id) => `${site}/${k}/${D.ids[k].get(id)}`;
  const artistUrl = id => D.ids.artist.has(id) ? U('artist', id) : '';
  const trackCover = t => { const al = t.albumId && D.AL.get(t.albumId); return img(t.coverId) || img(t.cover) || (al && (img(al.coverId) || img(al.cover))) || artistImg(D.A.get(t.artistId)) || site + '/icon-512.png'; };
  const who = t => [t.artistId, ...(t.featIds || [])].map(id => D.A.get(id)).filter(Boolean);
  const whoHtml = t => who(t).map((a, i) => (i === 1 ? ' ft. ' : i > 1 ? ', ' : '') + (artistUrl(a.id) ? `<a href="${esc(artistUrl(a.id))}">${esc(a.name)}</a>` : esc(a.name))).join('');
  const whoText = t => { const w = who(t).map(a => a.name); return w.length ? w[0] + (w.length > 1 ? ' ft. ' + w.slice(1).join(', ') : '') : ''; };
  const songList = list => `<ol class="list">${list.map(t => `<li><a href="${esc(U('song', t.id))}"><img src="${esc(trackCover(t))}" alt="" loading="lazy" width="48" height="48"><span><b>${esc(t.title)}</b><small>${esc(whoText(t))}${mmss(t.duration) ? ' · ' + mmss(t.duration) : ''}</small></span></a></li>`).join('')}</ol>`;

  // ---------- Sitemap ----------
  if (q.map) {
    const urls = [];
    const add = (loc, last) => urls.push(`<url><loc>${esc(loc)}</loc>${last ? `<lastmod>${last}</lastmod>` : ''}</url>`);
    const iso = ms => ms ? new Date(ms).toISOString().slice(0, 10) : '';
    for (const a of D.artists) add(U('artist', a.id), iso(Math.max(a.updatedAt || 0, ...D.byArtist.get(a.id).map(t => t.updatedAt || t.createdAt || 0))));
    for (const al of D.albums) add(U('album', al.id), iso(Math.max(al.updatedAt || al.createdAt || 0, ...D.byAlbum.get(al.id).map(t => t.updatedAt || 0))));
    for (const t of D.T) add(U('song', t.id), iso(t.updatedAt || t.createdAt));
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  }

  const k = String(q.k || ''), s = String(q.s || '').toLowerCase().slice(0, 140);
  const id = D.slugs[k] ? (D.slugs[k].get(s) || (D.ids[k].has(q.s) ? q.s : '')) : '';
  if (!id) return sendHtml(404, page({ site, title: 'Page not found — WMA MUSIC', desc: '', noindex: true, body: `<h1>Page not found</h1><p class="muted">This page does not exist or is no longer available.</p><p><a class="btn" href="${site}/">Open WMA MUSIC</a></p>` }));

  // ---------- Chanson ----------
  if (k === 'song') {
    const t = D.tById.get(id), a = D.A.get(t.artistId), al = t.albumId && D.byAlbum.has(t.albumId) ? D.AL.get(t.albumId) : null;
    const cover = trackCover(t), date = dateOf(t), by = whoText(t), url = U('song', id);
    const more = (D.byArtist.get(t.artistId) || []).filter(x => x.id !== id).slice(-8).reverse();
    const desc = `Listen to “${t.title}”${by ? ' by ' + by : ''} on WMA MUSIC — free African music streaming.${t.genre ? ' ' + t.genre + '.' : ''}${date ? ' Released ' + niceDate(date) + '.' : ''}`;
    const ld = { '@context': 'https://schema.org', '@type': 'MusicRecording', name: t.title, url, image: cover || undefined, genre: t.genre || undefined, datePublished: date || undefined, duration: isoDur(t.duration) || undefined,
      byArtist: who(t).map(x => ({ '@type': 'MusicGroup', name: x.name, url: artistUrl(x.id) || undefined })), inAlbum: al ? { '@type': 'MusicAlbum', name: al.title, url: U('album', al.id) } : undefined,
      potentialAction: { '@type': 'ListenAction', target: `${site}/#track-${id}` } };
    const facts = [t.genre && ['Genre', esc(t.genre)], date && ['Released', niceDate(date)], al && ['From', `<a href="${esc(U('album', al.id))}">${esc(al.title)}</a>`], mmss(t.duration) && ['Length', mmss(t.duration)], t.producer && ['Producer', esc(t.producer)], t.writers && ['Writers', esc(t.writers)], a && a.label && ['Label', esc(a.label)]].filter(Boolean);
    return sendHtml(200, page({ site, title: `${t.title}${by ? ' — ' + by : ''} | WMA MUSIC`, desc, url, image: cover, ogType: 'music.song', ld, crumbs: [a && [a.name, artistUrl(a.id)], [t.title]],
      body: `<div class="hero">${cover ? `<img class="cover" src="${esc(cover)}" alt="Cover of ${esc(t.title)}" width="300" height="300">` : ''}<div class="info"><p class="kind">Song</p><h1>${esc(t.title)}</h1><p class="by">${whoHtml(t)}</p>
      <p><a class="btn" href="${site}/#track-${esc(id)}">▶ Listen on WMA MUSIC</a></p></div></div>
      ${t.description ? `<p class="about">${esc(String(t.description).slice(0, 600))}</p>` : ''}${facts.length ? `<dl class="facts">${facts.map(([k2, v]) => `<div><dt>${k2}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
      ${more.length ? `<h2>More from ${esc(a.name)}</h2>${songList(more)}` : ''}` }));
  }

  // ---------- Album ----------
  if (k === 'album') {
    const al = D.AL.get(id), a = D.A.get(al.artistId), url = U('album', id);
    const tr = D.byAlbum.get(id).slice().sort((x, y) => (x.trackNo || 99) - (y.trackNo || 99) || (x.createdAt || 0) - (y.createdAt || 0));
    const cover = img(al.coverId) || img(al.cover) || trackCover(tr[0]), kind = /^ep$/i.test(al.type) ? 'EP' : /single/i.test(al.type) ? 'Single' : 'Album';
    const date = /^\d{4}-\d{2}-\d{2}/.test(al.date || '') ? al.date.slice(0, 10) : dateOf(tr[0]);
    const desc = `Listen to the ${kind.toLowerCase()} “${al.title}”${a ? ' by ' + a.name : ''} on WMA MUSIC — ${tr.length} song${tr.length > 1 ? 's' : ''}${date ? ', released ' + niceDate(date) : ''}.`;
    const ld = { '@context': 'https://schema.org', '@type': 'MusicAlbum', name: al.title, url, image: cover || undefined, datePublished: date || undefined, numTracks: tr.length, albumReleaseType: kind === 'EP' ? 'EPRelease' : kind === 'Single' ? 'SingleRelease' : 'AlbumRelease',
      byArtist: a ? { '@type': 'MusicGroup', name: a.name, url: artistUrl(a.id) || undefined } : undefined,
      track: { '@type': 'ItemList', numberOfItems: tr.length, itemListElement: tr.map((t, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'MusicRecording', name: t.title, url: U('song', t.id) } })) } };
    return sendHtml(200, page({ site, title: `${al.title}${a ? ' — ' + a.name : ''} (${kind}) | WMA MUSIC`, desc, url, image: cover, ogType: 'music.album', ld, crumbs: [a && [a.name, artistUrl(a.id)], [al.title]],
      body: `<div class="hero">${cover ? `<img class="cover" src="${esc(cover)}" alt="Cover of ${esc(al.title)}" width="300" height="300">` : ''}<div class="info"><p class="kind">${kind}</p><h1>${esc(al.title)}</h1><p class="by">${a ? (artistUrl(a.id) ? `<a href="${esc(artistUrl(a.id))}">${esc(a.name)}</a>` : esc(a.name)) : ''}${date ? ' · ' + niceDate(date) : ''} · ${tr.length} song${tr.length > 1 ? 's' : ''}</p>
      <p><a class="btn" href="${site}/#album-${esc(id)}">▶ Listen on WMA MUSIC</a></p></div></div><h2>Tracklist</h2>${songList(tr)}` }));
  }

  // ---------- Artiste ----------
  const a = D.A.get(id), url = U('artist', id), photo = artistImg(a) || site + '/icon-512.png', songs = (D.byArtist.get(id) || []).slice().reverse();
  const albs = D.albums.filter(x => x.artistId === id).reverse();
  const place = [a.city, a.country].filter(Boolean).join(', ');
  const bio = a.bio ? String(a.bio).replace(/\s+/g, ' ').trim() : '';
  const desc = bio ? bio.slice(0, 155) + (bio.length > 155 ? '…' : '') : `Listen to ${a.name}${place ? ' (' + place + ')' : ''} on WMA MUSIC: ${songs.slice(0, 3).map(t => t.title).join(', ')}.`;
  const socials = Object.entries(a.socials || {}).filter(([, v]) => /^https:\/\//.test(String(v || '')) && !/\/x$/.test(v));
  const ld = { '@context': 'https://schema.org', '@type': 'MusicGroup', name: a.name, url, image: photo || undefined, genre: a.genres ? String(a.genres).split(/[,/·]+/).map(x => x.trim()).filter(Boolean) : undefined,
    description: bio || undefined, foundingLocation: place ? { '@type': 'Place', name: place } : undefined, sameAs: socials.length ? socials.map(([, v]) => v) : undefined,
    track: songs.slice(0, 20).map(t => ({ '@type': 'MusicRecording', name: t.title, url: U('song', t.id) })) };
  const facts = [place && ['From', esc(place)], a.genres && ['Genres', esc(a.genres)], a.since && ['Active since', esc(a.since)], a.label && ['Label', esc(a.label)]].filter(Boolean);
  return sendHtml(200, page({ site, title: `${a.name} — Songs, albums and biography | WMA MUSIC`, desc, url, image: photo, ogType: 'profile', ld, crumbs: [[a.name]],
    body: `<div class="hero">${photo ? `<img class="cover round" src="${esc(photo)}" alt="${esc(a.name)}" width="300" height="300">` : ''}<div class="info"><p class="kind">Artist${a.verified ? ' · ✓ Verified' : ''}</p><h1>${esc(a.name)}</h1>${place ? `<p class="by">${esc(place)}</p>` : ''}
    <p><a class="btn" href="${site}/#artist-${esc(id)}">▶ Listen on WMA MUSIC</a></p></div></div>
    ${bio ? `<h2>Biography</h2><p class="about">${esc(bio.slice(0, 2000))}</p>` : ''}${facts.length ? `<dl class="facts">${facts.map(([k2, v]) => `<div><dt>${k2}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
    <h2>Songs</h2>${songList(songs.slice(0, 50))}
    ${albs.length ? `<h2>Albums and EPs</h2><ul class="grid">${albs.map(x => { const c = img(x.coverId) || img(x.cover) || trackCover(D.byAlbum.get(x.id)[0]); return `<li><a href="${esc(U('album', x.id))}"><img src="${esc(c)}" alt="Cover of ${esc(x.title)}" loading="lazy" width="160" height="160"><b>${esc(x.title)}</b></a></li>`; }).join('')}</ul>` : ''}
    ${socials.length ? `<h2>Follow ${esc(a.name)}</h2><p class="socials">${socials.map(([n, v]) => `<a href="${esc(v)}" rel="noopener" target="_blank">${esc(n[0].toUpperCase() + n.slice(1))}</a>`).join('')}</p>` : ''}` }));
};

function page({ site, title, desc, url, image, ogType = 'website', ld, crumbs, body, noindex }) {
  const crumbLd = crumbs && url ? { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'WMA MUSIC', item: site + '/' }, ...crumbs.filter(Boolean).map((c, i) => ({ '@type': 'ListItem', position: i + 2, name: c[0], item: c[1] || url }))] } : null;
  const json = o => JSON.stringify(o).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1">
${desc ? `<meta name="description" content="${esc(desc)}">` : ''}${noindex ? '<meta name="robots" content="noindex">' : ''}${url ? `<link rel="canonical" href="${esc(url)}">` : ''}
<meta name="theme-color" content="#0A0A0A"><link rel="icon" href="/icon-192.png">
<meta property="og:site_name" content="WMA MUSIC"><meta property="og:type" content="${esc(ogType)}"><meta property="og:title" content="${esc(title.replace(/ \| WMA MUSIC$/, ''))}">
${desc ? `<meta property="og:description" content="${esc(desc)}">` : ''}${url ? `<meta property="og:url" content="${esc(url)}">` : ''}<meta property="og:image" content="${esc(image || site + '/icon-512.png')}"><meta name="twitter:card" content="summary_large_image">
${ld ? `<script type="application/ld+json">${json(ld)}</script>` : ''}${crumbLd ? `<script type="application/ld+json">${json(crumbLd)}</script>` : ''}
<style>
:root{--o:#FF7A1A}*{box-sizing:border-box}body{margin:0;background:#0A0A0A;color:#f4f4f4;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#fff}header,main,footer{max-width:960px;margin:0 auto;padding-left:max(18px,env(safe-area-inset-left));padding-right:max(18px,env(safe-area-inset-right))}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:18px;padding-bottom:18px}.logo{font-weight:900;letter-spacing:.02em;text-decoration:none;font-size:18px}.logo b{color:var(--o)}
.open{font-size:14px;color:#ccc}nav.crumbs{font-size:13px;color:#999;margin:4px 0 18px}nav.crumbs a{color:#bbb}
.hero{display:flex;gap:28px;align-items:flex-end;flex-wrap:wrap}.cover{width:min(300px,100%);height:auto;aspect-ratio:1;object-fit:cover;border-radius:14px;box-shadow:0 20px 60px #000a}.cover.round{border-radius:50%}
.info{flex:1;min-width:0}.kind{margin:0;color:var(--o);font-weight:700;text-transform:uppercase;letter-spacing:.14em;font-size:12px}h1{font-size:clamp(30px,6vw,54px);line-height:1.05;margin:6px 0 8px;overflow-wrap:anywhere;text-wrap:balance}
.by{color:#ccc;margin:0 0 18px}.by a{color:var(--o);font-weight:700;text-decoration:none}
.btn{display:inline-block;background:var(--o);color:#0A0A0A;font-weight:800;text-decoration:none;padding:13px 24px;border-radius:999px}
h2{font-size:21px;margin:38px 0 12px}.about{color:#ddd;max-width:68ch;white-space:pre-line}.muted{color:#aaa}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin:22px 0 0}.facts div{background:#151515;border-radius:10px;padding:10px 14px}.facts dt{font-size:12px;color:#999;text-transform:uppercase;letter-spacing:.08em}.facts dd{margin:2px 0 0;font-weight:600}.facts a{color:var(--o)}
.list{list-style:none;padding:0;margin:0;display:grid;gap:4px}.list a{display:flex;gap:12px;align-items:center;text-decoration:none;padding:8px;border-radius:10px}.list a:hover{background:#171717}.list img{width:48px;height:48px;border-radius:6px;object-fit:cover;flex:none;background:#222}
.list span{display:flex;flex-direction:column;min-width:0}.list b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.list small{color:#aaa}
.grid{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}.grid a{text-decoration:none;display:flex;flex-direction:column;gap:8px}.grid img{width:100%;height:auto;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#222}
.socials{display:flex;flex-wrap:wrap;gap:10px}.socials a{border:1px solid #333;border-radius:999px;padding:7px 14px;text-decoration:none;font-size:14px}
footer{color:#888;font-size:13px;padding-top:40px;padding-bottom:40px;border-top:1px solid #1d1d1d;margin-top:48px}footer a{color:#bbb}
</style></head><body>
<header><a class="logo" href="${site}/">WMA <b>MUSIC</b></a><a class="open" href="${site}/">Open the app →</a></header>
<main>${crumbs ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="${site}/">WMA MUSIC</a>${crumbs.filter(Boolean).map(c => ' › ' + (c[1] ? `<a href="${esc(c[1])}">${esc(c[0])}</a>` : esc(c[0]))).join('')}</nav>` : ''}${body}</main>
<footer>WMA MUSIC — Your music. Your Africa. Your sound. Free African music streaming by WMA UNITED AFRICA. · <a href="${site}/download">Download the app</a></footer>
</body></html>`;
}
