// WMA MUSIC — notifications sur le téléphone (Web Push), sans service payant.
//
//   GET  /api/push?action=config   → { enabled, publicKey }  (public)
//   POST /api/push?action=due      → annonce les sorties devenues disponibles depuis moins de 48 h et pas encore annoncées.
//                                    Appelée automatiquement par l'application (n'importe quel visiteur peut la déclencher :
//                                    le serveur vérifie lui-même ce qui est sorti, et chaque sortie n'est annoncée qu'une fois).
//   POST /api/push?action=test     → envoie une notification d'essai sur les appareils de l'utilisateur connecté.
//
// Qui reçoit ? Les personnes qui suivent l'artiste (ou un artiste invité) et celles qui ont pré-enregistré le titre,
// et qui ont activé « Notifications sur ce téléphone » dans leur profil.
//
// Variables Vercel : SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (secrète),
//                    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (secrète), SITE_URL, VAPID_SUBJECT (facultatif).
// Chiffrement : RFC 8291 (aes128gcm) et authentification VAPID (RFC 8292), avec le module crypto de Node.
const crypto = require('crypto');

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function conf() {
  const e = process.env;
  const c = { sbUrl: String(e.SUPABASE_URL || '').replace(/\/+$/, ''), anon: e.SUPABASE_ANON_KEY || '', service: e.SUPABASE_SERVICE_ROLE_KEY || '',
    pub: e.VAPID_PUBLIC_KEY || '', priv: e.VAPID_PRIVATE_KEY || '', subject: e.VAPID_SUBJECT || 'mailto:worldmusicactus@gmail.com',
    site: String(e.SITE_URL || 'https://www.wmamusic.net').replace(/\/+$/, '') };
  c.ready = !!(c.sbUrl && c.anon && c.service && c.pub && c.priv);
  return c;
}

// ---------- VAPID ----------
function vapidHeader(c, endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: c.subject }));
  const pubRaw = unb64u(c.pub);
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pubRaw.subarray(1, 33)), y: b64u(pubRaw.subarray(33, 65)), d: c.priv }, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${c.pub}`;
}

// ---------- chiffrement du message (RFC 8291) ----------
function encrypt(payload, p256dh, authSecret) {
  const ua = unb64u(p256dh), auth = unb64u(authSecret);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const asPub = ecdh.getPublicKey(), shared = ecdh.computeSecret(ua);
  const prkKey = hmac(auth, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub, Buffer.from([1])])).subarray(0, 32);
  const salt = crypto.randomBytes(16), prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const ci = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([ci.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), ci.final(), ci.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, ct]);
}

async function sendOne(c, sub, msg) {
  const body = encrypt(JSON.stringify(msg), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, { method: 'POST', headers: { Authorization: vapidHeader(c, sub.endpoint), TTL: '172800', Urgency: 'normal',
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Topic: String(msg.tag || 'wma').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'wma' }, body });
  return r.status;
}

// ---------- Supabase ----------
async function sb(c, path, { method = 'GET', body, auth, prefer } = {}) {
  const h = { apikey: auth ? c.anon : c.service, Authorization: auth || ('Bearer ' + c.service), 'Content-Type': 'application/json' };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(c.sbUrl + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
  if (!r.ok) { const er = new Error('supabase ' + r.status + ' ' + String((j && j.message) || t).slice(0, 160)); er.status = r.status; throw er; }
  return j;
}
const imgUrl = (c, v) => !v || typeof v !== 'string' ? '' : /^https:\/\//.test(v) ? v : /^img\//.test(v) ? `${c.sbUrl}/storage/v1/object/public/music-images/${v.split('/').map(encodeURIComponent).join('/')}` : '';

async function deliver(c, subs, msgFor) {
  let ok = 0;
  for (let i = 0; i < subs.length; i += 20) {
    await Promise.all(subs.slice(i, i + 20).map(async s => {
      try {
        const st = await sendOne(c, s, msgFor(s));
        const enc = encodeURIComponent(s.endpoint);
        if (st === 404 || st === 410) await sb(c, `/rest/v1/music_push_subs?endpoint=eq.${enc}`, { method: 'DELETE' });
        else if (st >= 200 && st < 300) { ok++; await sb(c, `/rest/v1/music_push_subs?endpoint=eq.${enc}`, { method: 'PATCH', body: { last_ok: new Date().toISOString(), fails: 0 } }); }
        else await sb(c, `/rest/v1/music_push_subs?endpoint=eq.${enc}`, { method: 'PATCH', body: { fails: (s.fails || 0) + 1 } });
      } catch (e) { /* un appareil injoignable ne bloque pas les autres */ }
    }));
  }
  return ok;
}

// Sorties devenues disponibles depuis moins de 48 h
async function dueReleases(c) {
  const now = Date.now(), since = now - 48 * 3600e3;
  const docs = await sb(c, '/rest/v1/music_docs?select=id,data&kind=eq.tracks');
  const artists = {}; (await sb(c, '/rest/v1/music_docs?select=id,data&kind=eq.artists')).forEach(a => { artists[a.id] = a.data || {}; });
  const albums = {}; (await sb(c, '/rest/v1/music_docs?select=id,data&kind=eq.albums')).forEach(a => { albums[a.id] = a.data || {}; });
  const live = [];
  for (const d of docs || []) {
    const t = { ...(d.data || {}), id: d.id };
    const at = t.status === 'published' ? (t.publishedAt || t.createdAt || 0) : t.status === 'scheduled' && t.publishAt && t.publishAt <= now ? t.publishAt : 0;
    if (at && at >= since && !t.demo) live.push({ t, at });
  }
  // un album sorti d'un coup = une seule annonce
  const groups = {};
  for (const x of live) { const k = x.t.albumId && albums[x.t.albumId] ? 'album:' + x.t.albumId : 'track:' + x.t.id; (groups[k] = groups[k] || []).push(x); }
  return Object.entries(groups).map(([ref, xs]) => {
    const t0 = xs.sort((a, b) => (a.t.trackNo || 0) - (b.t.trackNo || 0))[0].t;
    const isAlbum = ref.startsWith('album:') && xs.length > 1;
    const al = t0.albumId && albums[t0.albumId];
    const ar = artists[t0.artistId] || {};
    const ids = [...new Set(xs.flatMap(x => [x.t.artistId, ...(x.t.featIds || [])]).filter(Boolean))];
    return { ref: isAlbum ? ref : 'track:' + t0.id, refs: isAlbum ? [ref, ...xs.map(x => 'track:' + x.t.id)] : ['track:' + t0.id], artistIds: ids, trackIds: xs.map(x => x.t.id),
      title: isAlbum ? (al.title || t0.title) : t0.title, artist: ar.name || '', type: isAlbum ? (al.type || 'Album') : 'song',
      url: isAlbum ? `${c.site}/#album-${t0.albumId}` : `${c.site}/#track-${t0.id}`,
      image: imgUrl(c, isAlbum ? (al.coverId || al.cover) : (t0.coverId || t0.cover || (al && (al.coverId || al.cover)))) };
  });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const c = conf(), action = String((req.query && req.query.action) || '');
  const send = (code, o) => res.status(code).json(o);
  try {
    if (action === 'config') return send(200, { enabled: c.ready, publicKey: c.ready ? c.pub : '' });
    if (!c.ready) return send(501, { error: 'not_configured' });
    if (req.method !== 'POST') return send(405, { error: 'method' });

    if (action === 'test') {
      const auth = String(req.headers.authorization || '');
      if (!/^Bearer\s+\S+$/.test(auth)) return send(401, { error: 'auth' });
      const user = await sb(c, '/auth/v1/user', { auth }).catch(() => null);
      if (!user || !user.id) return send(401, { error: 'auth' });
      const subs = await sb(c, `/rest/v1/music_push_subs?user_id=eq.${user.id}&select=*`);
      const n = await deliver(c, subs || [], s => ({ title: 'WMA MUSIC', body: s.lang === 'fr' ? 'Les notifications fonctionnent sur ce téléphone ✓' : 'Notifications work on this phone ✓', url: c.site + '/#profile', tag: 'test' }));
      return send(200, { sent: n, devices: (subs || []).length });
    }

    if (action === 'due') {
      const list = await dueReleases(c);
      const out = [];
      for (const r of list) {
        // on « réserve » l'annonce avant d'envoyer : si deux visiteurs déclenchent en même temps, un seul envoie
        const claim = await sb(c, '/rest/v1/music_push_sent?on_conflict=ref', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
          body: r.refs.map(ref => ({ ref, title: r.title.slice(0, 120) })) });
        if (!claim || !claim.some(x => x.ref === r.ref)) continue;
        const subs = await sb(c, '/rest/v1/rpc/music_push_targets', { method: 'POST', body: { p_artists: r.artistIds, p_tracks: r.trackIds } });
        const n = await deliver(c, subs || [], s => {
          const fr = s.lang === 'fr', isA = r.type !== 'song';
          return { title: r.artist ? (fr ? `${r.artist} : ${isA ? 'nouvel ' + (r.type === 'EP' ? 'EP' : 'album') : 'nouveau titre'}` : `New ${isA ? r.type : 'song'} from ${r.artist}`) : 'WMA MUSIC',
            body: `“${r.title}” ${fr ? 'est disponible sur WMA MUSIC. Écoutez-le maintenant.' : 'is out now on WMA MUSIC. Listen now.'}`, url: r.url, image: r.image, tag: r.ref.replace(':', '-') };
        });
        await sb(c, `/rest/v1/music_push_sent?ref=eq.${encodeURIComponent(r.ref)}`, { method: 'PATCH', body: { sent: n } });
        out.push({ ref: r.ref, sent: n });
      }
      return send(200, { ok: true, announced: out });
    }
    return send(404, { error: 'unknown_action' });
  } catch (e) {
    console.error('push', action, e && e.message);
    return send(500, { error: 'server' });
  }
};
module.exports._test = { encrypt, vapidHeader, b64u, unb64u };
