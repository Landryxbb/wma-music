// WMA MUSIC — Smartlink : une page par sortie, avec un bouton par plateforme.
// Adresse : /l/<adresse>  (ex. /l/motivation). Les Smartlinks sont créés dans WMA ADMIN › Smartlinks
// et enregistrés dans music_docs (kind = 'meta', id = 'smartlinks').
// Avant la date de sortie : compte à rebours ; à l'heure de sortie, les boutons apparaissent.
// Variables Vercel utilisées : SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL (facultatif). Aucune clé secrète.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PLATFORMS = [
  ['wma', 'WMA MUSIC', '#FF7A1A'], ['spotify', 'Spotify', '#1DB954'], ['apple', 'Apple Music', '#FA2D48'], ['youtube', 'YouTube', '#FF0000'],
  ['ytmusic', 'YouTube Music', '#FF0033'], ['audiomack', 'Audiomack', '#FFA200'], ['boomplay', 'Boomplay', '#2F6BFF'], ['deezer', 'Deezer', '#A238FF'],
  ['mdundo', 'Mdundo', '#E31E24'], ['amazon', 'Amazon Music', '#25D1DA'], ['tidal', 'TIDAL', '#2B2B2B'], ['soundcloud', 'SoundCloud', '#FF5500'],
  ['anghami', 'Anghami', '#9B3DF2'], ['tiktok', 'TikTok', '#2B2B2B'], ['instagram', 'Instagram', '#E1306C']
];
const SOCIAL = { tiktok: 1, instagram: 1 };
// Logos officiels fournis par WMA (à la racine du site : /spotify.png, /youtube.png…). Un logo envoyé dans WMA ADMIN › Smartlinks les remplace.
const DEFAULT_LOGOS = ['spotify', 'youtube', 'ytmusic', 'audiomack', 'boomplay', 'deezer', 'amazon', 'tidal'];
const T = {
  en: { listen: 'Listen now', soon: 'Out soon', out: 'Out', choose: 'Choose your platform', play: 'Play', open: 'Open', follow: 'Follow', d: 'days', h: 'hours', m: 'min', s: 'sec',
    links: 'The links appear here on release day.', share: 'Share', copied: 'Link copied', nf: 'This Smartlink does not exist or has been removed.', home: 'Go to WMA MUSIC', tz: 'Kampala time', by: 'by', ready: 'Out now!' },
  fr: { listen: 'Écouter maintenant', soon: 'Bientôt disponible', out: 'Sortie', choose: 'Choisissez votre plateforme', play: 'Écouter', open: 'Ouvrir', follow: 'Suivre', d: 'jours', h: 'heures', m: 'min', s: 'sec',
    links: 'Les liens apparaîtront ici le jour de la sortie.', share: 'Partager', copied: 'Lien copié', nf: "Ce Smartlink n'existe pas ou a été supprimé.", home: 'Aller sur WMA MUSIC', tz: 'heure de Kampala', by: 'de', ready: 'Disponible maintenant !' }
};
const SUN = '<svg viewBox="0 0 100 100" aria-hidden="true"><g transform="translate(50 50)" fill="currentColor"><circle r="13"/>' +
  [0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => `<rect x="-3" y="${i % 2 ? -36 : -46}" width="6" height="${i % 2 ? 16 : 26}" rx="3" transform="rotate(${a})"/>`).join('') + '</g></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
const PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4.5 20c.8-4 3.9-6 7.5-6s6.7 2 7.5 6z" fill="currentColor"/></svg>';

module.exports = async (req, res) => {
  const site = (process.env.SITE_URL || ('https://' + (req.headers.host || 'www.wmamusic.net'))).replace(/\/+$/, '');
  const slug = String((req.query && req.query.s) || '').toLowerCase();
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_ANON_KEY || '';
  const lang = /^fr/i.test(String(req.headers['accept-language'] || '')) ? 'fr' : 'en';
  const L = T[lang];
  const img = v => {
    if (!v || typeof v !== 'string' || v.startsWith('data:') || v.startsWith('blob:')) return '';
    if (/^https:\/\//.test(v)) return v;
    if (v.startsWith('/')) return site + v;
    if (/^img\//.test(v) && base) return `${base}/storage/v1/object/public/music-images/${v.split('/').map(encodeURIComponent).join('/')}`;
    return '';
  };
  let item = null, icons = {};
  if (/^[a-z0-9][a-z0-9-]{0,59}$/.test(slug) && base && key) {
    try {
      const r = await fetch(`${base}/rest/v1/music_docs?select=data&kind=eq.meta&id=eq.smartlinks`, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
      if (r.ok) { const j = await r.json(); const items = (j[0] && j[0].data && j[0].data.items) || []; item = items.find(x => x && x.slug === slug && !x.hidden) || null; icons = (j[0] && j[0].data && j[0].data.icons) || {}; }
    } catch (e) { item = null; }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Vary', 'Accept-Language');
  const head = (title, desc, image, url) => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<title>${esc(title)}</title><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="${esc(desc)}"><meta name="theme-color" content="#0A0A0A"><link rel="canonical" href="${esc(url)}">
<meta property="og:site_name" content="WMA MUSIC"><meta property="og:type" content="music.song"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(image)}"><meta property="og:image:secure_url" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(image)}">
<link rel="icon" href="${site}/icon-192.png"><link rel="apple-touch-icon" href="${site}/icon-192.png">`;
  if (!item) {
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30');
    res.status(404).send(head('WMA MUSIC', L.nf, `${site}/icon-512.png`, site + '/') + `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0A0A;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center;padding:24px}a{display:inline-block;margin-top:18px;background:#FF7A1A;color:#0A0A0A;font-weight:800;text-decoration:none;padding:13px 22px;border-radius:999px}.s{width:64px;height:64px;color:#FF7A1A;margin:0 auto 14px}</style></head><body><div><div class="s">${SUN}</div><p>${esc(L.nf)}</p><a href="${site}/">${esc(L.home)}</a></div></body></html>`);
    return;
  }
  const now = Date.now();
  const rel = +item.releaseAt || 0;
  const upcoming = rel > now;
  const links = PLATFORMS.filter(([k]) => typeof (item.links || {})[k] === 'string' && /^https:\/\//.test(item.links[k]));
  const cover = img(item.coverId) || img(item.cover) || `${site}/icon-512.png`;
  const title = item.title || 'WMA MUSIC';
  const artist = item.artist || '';
  const fmt = ms => { try { return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kampala' }).format(new Date(ms)); } catch (e) { return new Date(ms).toDateString(); } };
  const fmtH = ms => { try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }).format(new Date(ms)); } catch (e) { return ''; } };
  const dateTxt = rel ? fmt(rel) : '';
  const desc = upcoming ? `${title}${artist ? ' — ' + artist : ''} · ${L.out} : ${dateTxt}` : `${lang === 'fr' ? 'Écoutez' : 'Listen to'} “${title}”${artist ? ' ' + L.by + ' ' + artist : ''} 🎧`;
  const url = `${site}/l/${slug}`;
  const btn = ([k, name, col]) => {
    const soc = SOCIAL[k];
    const logo = img(icons[k]) || (DEFAULT_LOGOS.includes(k) ? `${site}/${k}.png` : '');
    const ic = logo ? `<span class="ic logo"><img src="${esc(logo)}" alt="" width="40" height="40" loading="lazy"></span>` : `<span class="ic${k === 'wma' ? ' wma' : ''}" style="background:${col}">${k === 'wma' ? SUN : soc ? PERSON : PLAY}</span>`;
    return `<a class="pl" href="${esc(item.links[k])}" target="_blank" rel="noopener" data-k="${k}">${ic}<span class="nm">${esc(name)}</span><span class="go">${esc(soc ? L.follow : k === 'wma' ? L.play : L.play)}</span></a>`;
  };
  const html = head(`${title}${artist ? ' — ' + artist : ''}`, desc, cover, url) + `
<style>
:root{--a:#FF7A1A}
*{box-sizing:border-box}html,body{margin:0}
body{min-height:100vh;background:#0A0A0A;color:#fff;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.bg{position:fixed;inset:-80px;background:url("${esc(cover)}") center/cover;filter:blur(60px) brightness(.42) saturate(1.25);transform:scale(1.1)}
.sh{position:fixed;inset:0;background:radial-gradient(90% 60% at 50% 0%,rgba(255,122,26,.18),transparent 70%),linear-gradient(180deg,rgba(10,10,10,.25),#0A0A0A 85%)}
main{position:relative;max-width:480px;margin:0 auto;padding:calc(34px + env(safe-area-inset-top,0px)) max(18px,env(safe-area-inset-right,0px)) calc(28px + env(safe-area-inset-bottom,0px)) max(18px,env(safe-area-inset-left,0px));display:flex;flex-direction:column;align-items:center;text-align:center}
.cv{width:min(78vw,320px);aspect-ratio:1;border-radius:18px;object-fit:cover;box-shadow:0 28px 70px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.08);background:#1a1a1a}
.tag{margin-top:24px;font-size:11.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#0A0A0A;background:var(--a);padding:6px 11px;border-radius:999px}
h1{margin:14px 0 4px;font-size:clamp(28px,8vw,38px);line-height:1.05;letter-spacing:-.02em;text-wrap:balance}
.ar{font-size:17px;font-weight:600;color:rgba(255,255,255,.78)}
.dt{margin-top:18px;font-size:15px;font-weight:600;color:rgba(255,255,255,.9)}.dt small{display:block;margin-top:3px;font-size:12.5px;font-weight:500;color:rgba(255,255,255,.55)}
.cd{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;width:100%;margin-top:16px}
.cd div{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px 4px 10px}
.cd b{display:block;font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;color:var(--a)}.cd span{display:block;margin-top:6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.6)}
.ch{margin:26px 0 10px;font-size:13px;color:rgba(255,255,255,.6)}
.list{width:100%;display:flex;flex-direction:column;gap:9px}
.pl{display:flex;align-items:center;gap:13px;padding:10px 12px 10px 10px;border-radius:16px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);color:#fff;text-decoration:none;transition:transform .15s,background .15s}
.pl:hover{background:rgba(255,255,255,.13)}.pl:active{transform:scale(.98)}
.ic{width:40px;height:40px;border-radius:11px;display:grid;place-items:center;color:#fff;flex:none}.ic svg{width:20px;height:20px}.ic.logo{background:none}.ic.logo img{width:40px;height:40px;object-fit:contain;border-radius:10px}.ic.wma{color:#0A0A0A}.ic.wma svg{width:28px;height:28px}
.nm{flex:1;min-width:0;text-align:left;font-weight:700;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.go{font-size:13px;font-weight:800;color:#0A0A0A;background:#fff;border-radius:999px;padding:7px 14px}
.pl[data-k="wma"] .go{background:var(--a)}
.wait{margin-top:22px;font-size:14px;color:rgba(255,255,255,.65)}
.shr{margin-top:22px;background:none;border:1px solid rgba(255,255,255,.25);color:#fff;font:inherit;font-weight:700;font-size:14px;padding:10px 18px;border-radius:999px;cursor:pointer}
.ft{margin-top:30px;display:flex;align-items:center;gap:8px;color:rgba(255,255,255,.55);font-size:12.5px;text-decoration:none}.ft svg{width:20px;height:20px;color:var(--a)}
[hidden]{display:none!important}
</style></head><body><div class="bg"></div><div class="sh"></div>
<main>
<img class="cv" src="${esc(cover)}" alt="${esc(title)}" width="320" height="320">
<span class="tag" id="tag">${esc(upcoming ? L.soon : L.listen)}</span>
<h1>${esc(title)}</h1>${artist ? `<div class="ar">${esc(artist)}</div>` : ''}
${upcoming ? `<div class="dt" id="dt">${esc(L.out)} : ${esc(dateTxt)}<small>${esc(fmtH(rel))} · ${esc(L.tz)}</small></div>
<div class="cd" id="cd"><div><b id="cd-d">–</b><span>${L.d}</span></div><div><b id="cd-h">–</b><span>${L.h}</span></div><div><b id="cd-m">–</b><span>${L.m}</span></div><div><b id="cd-s">–</b><span>${L.s}</span></div></div>` : ''}
${links.length ? `<p class="ch" id="ch"${upcoming ? ' hidden' : ''}>${esc(L.choose)}</p><div class="list" id="list"${upcoming ? ' hidden' : ''}>${links.map(btn).join('')}</div>` : ''}
${upcoming || !links.length ? `<p class="wait" id="wait">${esc(L.links)}</p>` : ''}
<button class="shr" id="shr" type="button">${esc(L.share)}</button>
<a class="ft" href="${site}/" target="_blank" rel="noopener">${SUN}<span>Smartlink · WMA MUSIC</span></a>
</main>
<script>
(function(){var R=${rel},has=${links.length ? 'true' : 'false'},L=${JSON.stringify({ ready: L.ready, copied: L.copied, listen: L.listen })};
function p(n){return n<10?'0'+n:''+n}
function tick(){var left=R-Date.now();if(left<=0){var t=document.getElementById('tag');if(t)t.textContent=has?L.listen:L.ready;['cd','dt'].forEach(function(i){var e=document.getElementById(i);if(e)e.hidden=true});
  if(has){['ch','list'].forEach(function(i){var e=document.getElementById(i);if(e)e.hidden=false});var w=document.getElementById('wait');if(w)w.hidden=true}else{setTimeout(function(){location.reload()},60000)}return false}
 var s=Math.floor(left/1000);document.getElementById('cd-d').textContent=Math.floor(s/86400);document.getElementById('cd-h').textContent=p(Math.floor(s%86400/3600));document.getElementById('cd-m').textContent=p(Math.floor(s%3600/60));document.getElementById('cd-s').textContent=p(s%60);return true}
if(document.getElementById('cd')&&tick()){var iv=setInterval(function(){if(!tick())clearInterval(iv)},1000)}
document.getElementById('shr').addEventListener('click',function(){var u=location.origin+location.pathname,t=document.title;
 if(navigator.share){navigator.share({title:t,url:u}).catch(function(){});return}
 var b=this;function done(){var o=b.textContent;b.textContent=L.copied;setTimeout(function(){b.textContent=o},1800)}
 if(navigator.clipboard)navigator.clipboard.writeText(u).then(done,function(){prompt('',u)});else prompt('',u)});
})();
</script></body></html>`;
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  res.status(200).send(html);
};
