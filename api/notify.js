// WMA MUSIC — e-mail à l'artiste quand sa soumission est acceptée et publiée.
// Appelé par WMA ADMIN uniquement. Vérifie côté serveur :
//   1) que la personne connectée est bien administratrice WMA (Supabase),
//   2) que la soumission est « acceptée » et que la chanson est bien publiée,
// puis envoie l'e-mail avec Resend (https://resend.com).
// Variables Vercel nécessaires : RESEND_API_KEY, MAIL_FROM, SUPABASE_URL, SUPABASE_ANON_KEY
// (facultatif : SITE_URL, par défaut https://www.wmamusic.net)
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const { RESEND_API_KEY, MAIL_FROM, SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!RESEND_API_KEY || !MAIL_FROM || !SUPABASE_URL || !SUPABASE_ANON_KEY) return res.status(501).json({ error: 'not_configured' });
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+$/.test(auth)) return res.status(401).json({ error: 'auth' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const sid = String((body && body.submissionId) || ''), tid = String((body && body.trackId) || '');
  if (!/^[0-9a-f-]{36}$/i.test(sid) || !/^[a-z0-9_-]{2,60}$/i.test(tid)) return res.status(400).json({ error: 'bad_request' });
  const base = SUPABASE_URL.replace(/\/+$/, '');
  const sb = (path) => fetch(base + path, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth } }).then(r => r.ok ? r.json() : Promise.reject(r.status));
  try {
    // 1) qui appelle ? (le jeton est vérifié par Supabase)
    const user = await sb('/auth/v1/user');
    const prof = await sb(`/rest/v1/music_profiles?select=role&id=eq.${encodeURIComponent(user.id)}`);
    if (!prof[0] || prof[0].role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    // 2) la soumission (lisible par un admin uniquement) et la chanson publiée
    const subs = await sb(`/rest/v1/music_submissions?select=title,artists,email,status&id=eq.${sid}`);
    const s = subs[0];
    if (!s || s.status !== 'accepted') return res.status(409).json({ error: 'not_accepted' });
    const docs = await sb(`/rest/v1/music_docs?select=data&kind=eq.tracks&id=eq.${encodeURIComponent(tid)}`);
    const t = docs[0] && docs[0].data;
    if (!t || t.status !== 'published' || t.submissionId !== sid) return res.status(409).json({ error: 'not_published' });
    const site = (process.env.SITE_URL || 'https://www.wmamusic.net').replace(/\/+$/, '');
    const link = `${site}/#track-${tid}`;
    const subject = `Your song “${s.title}” is now live on WMA MUSIC`;
    const text = `Hello ${s.artists},\n\nGreat news! The WMA team selected your song “${s.title}”. It is now online on WMA MUSIC.\n\nListen and share it here: ${link}\n\nThank you for trusting WMA.\nThe WMA MUSIC team`;
    const html = `<div style="background:#0A0A0A;padding:32px 16px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#161618;border-radius:16px;padding:32px;color:#FFFFFF">
    <div style="color:#FF7A1A;font-weight:800;font-size:20px;letter-spacing:.5px">WMA MUSIC</div>
    <h1 style="font-size:24px;line-height:1.3;margin:20px 0 12px">“${esc(s.title)}” is now live 🎉</h1>
    <p style="color:#D0D0D4;font-size:16px;line-height:1.6;margin:0 0 24px">Hello ${esc(s.artists)},<br><br>Great news! The WMA team selected your song. It is now online on WMA MUSIC — listen to it and share it with your fans.</p>
    <a href="${esc(link)}" style="display:inline-block;background:#FF7A1A;color:#0A0A0A;text-decoration:none;font-weight:800;padding:14px 26px;border-radius:999px">▶ Listen on WMA MUSIC</a>
    <p style="color:#8E8E93;font-size:13px;line-height:1.5;margin:28px 0 0">Or copy this link: ${esc(link)}<br><br>Thank you for trusting WMA.<br>The WMA MUSIC team</p>
  </div></div>`;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [s.email], subject, html, text })
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); return res.status(502).json({ error: 'mail_failed', detail: j.message || r.status }); }
    return res.status(200).json({ sent: true });
  } catch (e) {
    return res.status(typeof e === 'number' ? (e === 401 ? 401 : 502) : 500).json({ error: 'server' });
  }
};
