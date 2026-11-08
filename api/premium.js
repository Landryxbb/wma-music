// WMA MUSIC — Abonnement PREMIUM (paiement Mobile Money via pawaPay : Ouganda et RDC)
//
// Une seule fonction serveur, plusieurs actions (?action=...) :
//   config     GET   prix, pays et opérateurs disponibles (public)
//   pay        POST  lance un paiement (utilisateur connecté)
//   status     GET   état d'un paiement ; interroge pawaPay tant qu'il est en attente
//   callback   POST  notification envoyée par pawaPay (webhook)
//   download   GET   lien temporaire pour télécharger une chanson (Premium actif uniquement)
//   reconcile  GET   tâche planifiée : revérifie les paiements restés en attente
//
// RÈGLE DE SÉCURITÉ : Premium n'est JAMAIS activé sur la parole de l'utilisateur ni sur le seul
// contenu d'un webhook. Le serveur interroge toujours lui-même pawaPay (GET /v2/deposits/{id})
// avec la clé secrète, vérifie le montant et la devise, puis active via une fonction SQL
// idempotente (un même paiement ne peut jamais être compté deux fois).
//
// Variables d'environnement Vercel :
//   SUPABASE_URL, SUPABASE_ANON_KEY          (déjà présentes)
//   SUPABASE_SERVICE_ROLE_KEY                secrète — Supabase > Settings > API > service_role
//   PAWAPAY_API_TOKEN                        secrète — tableau de bord pawaPay > API tokens
//   PAWAPAY_ENV                              « sandbox » (tests) ou « production »
//   PAWAPAY_CALLBACK_KEY                     secrète — longue chaîne aléatoire, aussi mise dans l'URL de callback
//   PREMIUM_PRICE_USD   (facultatif, 1.50)   prix en dollars (RDC)
//   PREMIUM_PRICE_UGX   (facultatif, 5500)   prix en shillings ougandais
//   PAWAPAY_PUBLIC_KEY  (facultatif)         clé publique pawaPay (PEM) pour vérifier la signature des callbacks
//   CRON_SECRET         (facultatif)         protège la tâche planifiée « reconcile »
const crypto = require('crypto');

const COUNTRIES = {
  UGA: { name: 'Uganda', prefix: '256', len: 12, currency: 'UGX',
    providers: { MTN_MOMO_UGA: 'MTN Mobile Money', AIRTEL_OAPI_UGA: 'Airtel Money' } },
  COD: { name: 'DR Congo', prefix: '243', len: 12, currency: 'USD',
    providers: { VODACOM_MPESA_COD: 'Vodacom M-Pesa', AIRTEL_COD: 'Airtel Money', ORANGE_COD: 'Orange Money' } }
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function conf() {
  const e = process.env;
  const c = {
    sbUrl: String(e.SUPABASE_URL || '').replace(/\/+$/, ''), anon: e.SUPABASE_ANON_KEY || '', service: e.SUPABASE_SERVICE_ROLE_KEY || '',
    token: e.PAWAPAY_API_TOKEN || '', ppBase: /^prod/i.test(e.PAWAPAY_ENV || '') ? 'https://api.pawapay.io' : 'https://api.sandbox.pawapay.io',
    sandbox: !/^prod/i.test(e.PAWAPAY_ENV || ''), cbKey: e.PAWAPAY_CALLBACK_KEY || '', pubKey: e.PAWAPAY_PUBLIC_KEY || '',
    prices: { USD: money(e.PREMIUM_PRICE_USD, '1.50'), UGX: String(Math.round(Number(e.PREMIUM_PRICE_UGX) || 5500)) }
  };
  c.ready = !!(c.sbUrl && c.anon && c.service && c.token && c.cbKey);
  return c;
}
function money(v, d) { const n = Number(v); return n > 0 ? n.toFixed(2) : d; }
const amountFor = (c, country) => c.prices[COUNTRIES[country].currency];

// ---------- appels Supabase ----------
async function sbFetch(c, path, { method = 'GET', body, key, auth, prefer } = {}) {
  const h = { apikey: key || c.service, Authorization: auth || ('Bearer ' + (key || c.service)), 'Content-Type': 'application/json' };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(c.sbUrl + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = t; }
  if (!r.ok) { const err = new Error('supabase ' + r.status + ' ' + (j && j.message || t).toString().slice(0, 200)); err.status = r.status; throw err; }
  return j;
}
const rpc = (c, fn, args) => sbFetch(c, '/rest/v1/rpc/' + fn, { method: 'POST', body: args });
async function currentUser(c, req) {
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+$/.test(auth)) return null;
  try { const u = await sbFetch(c, '/auth/v1/user', { key: c.anon, auth }); return u && u.id ? { id: u.id, auth } : null; } catch (e) { return null; }
}
async function getPayment(c, id) { const r = await sbFetch(c, `/rest/v1/music_premium_payments?id=eq.${id}&select=*`); return r && r[0] || null; }

// ---------- appels pawaPay ----------
async function pp(c, path, opts = {}) {
  const r = await fetch(c.ppBase + path, { method: opts.method || 'GET', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
  return { http: r.status, json: j };
}

// Vérifie l'état réel du paiement auprès de pawaPay et met à jour la base. Ne fait confiance à rien d'autre.
async function verifyWithPawaPay(c, pay) {
  if (!pay || pay.status !== 'pending') return pay;
  const r = await pp(c, '/v2/deposits/' + pay.id);
  if (r.http !== 200 || !r.json) return pay;                                 // pawaPay injoignable : on réessaiera
  if (r.json.status === 'NOT_FOUND') {
    if (Date.now() - Date.parse(pay.created_at) > 30 * 60e3) await rpc(c, 'music_premium_fail', { p_id: pay.id, p_reason: 'NOT_FOUND', p_raw: r.json });
    return getPayment(c, pay.id);
  }
  const d = r.json.data || {};
  if (r.json.status !== 'FOUND' || d.depositId !== pay.id) return pay;
  if (d.status === 'COMPLETED') {
    await rpc(c, 'music_premium_complete', { p_id: pay.id, p_amount: Number(d.amount), p_currency: String(d.currency || ''), p_tx: String(d.providerTransactionId || ''), p_raw: d });
  } else if (d.status === 'FAILED') {
    await rpc(c, 'music_premium_fail', { p_id: pay.id, p_reason: String((d.failureReason && d.failureReason.failureCode) || 'FAILED'), p_raw: d });
  }
  return getPayment(c, pay.id);
}
const publicPay = p => p && ({ id: p.id, status: p.status, failure: p.failure, amount: p.amount, currency: p.currency, operator: p.operator, period_end: p.period_end, created_at: p.created_at });

function normPhone(country, raw) {
  const C = COUNTRIES[country]; let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = C.prefix + d.slice(1);
  if (!d.startsWith(C.prefix)) d = C.prefix + d;
  return d.length === C.len && d[C.prefix.length] !== '0' ? d : null;
}

// ---------- signature des callbacks (RFC 9421), si PAWAPAY_PUBLIC_KEY est configurée ----------
async function rawBody(req) {
  // lit le corps brut (nécessaire pour vérifier la signature) ; sinon, retombe sur le corps déjà décodé
  if (req.readable && !req.readableEnded) {
    const s = await new Promise(ok => { let x = ''; req.setEncoding('utf8'); req.on('data', ch => x += ch); req.on('end', () => ok(x)); req.on('error', () => ok(x)); setTimeout(() => ok(x), 3000); });
    if (s) return s;
  }
  const b = req.body;
  return typeof b === 'string' ? b : Buffer.isBuffer(b) ? b.toString('utf8') : b ? JSON.stringify(b) : '';
}
function verifySignature(req, body, pem) {
  try {
    const digest = String(req.headers['content-digest'] || '');
    const m = digest.match(/sha-(256|512)=:([^:]+):/);
    if (!m || crypto.createHash('sha' + m[1]).update(body).digest('base64') !== m[2]) return false;
    const input = String(req.headers['signature-input'] || ''), sigH = String(req.headers['signature'] || '');
    const im = input.match(/^([\w-]+)=(\((.*?)\)(.*))$/);
    if (!im) return false;
    const label = im[1], params = im[2], comps = (im[3].match(/"[^"]+"/g) || []).map(x => x.slice(1, -1));
    const sm = sigH.match(new RegExp(label.replace(/[-]/g, '\\-') + '=:([^:]+):'));
    if (!sm) return false;
    const u = new URL(req.url, 'https://' + (req.headers.host || 'localhost'));
    const val = n => n === '@method' ? req.method.toUpperCase() : n === '@authority' ? String(req.headers.host || '').toLowerCase()
      : n === '@path' ? u.pathname : n === '@query' ? (u.search || '?') : n === '@target-uri' ? u.href : n === '@request-target' ? u.pathname + u.search
      : String(req.headers[n.toLowerCase()] || '').trim();
    const base = comps.map(n => `"${n}": ${val(n)}`).join('\n') + `\n"@signature-params": ${params}`;
    const alg = (params.match(/alg="([^"]+)"/) || [])[1] || 'ecdsa-p256-sha256';
    const key = crypto.createPublicKey(pem.replace(/\\n/g, '\n')), sig = Buffer.from(sm[1], 'base64'), data = Buffer.from(base);
    if (/^ecdsa-p256/.test(alg)) return crypto.verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig);
    if (/^ecdsa-p384/.test(alg)) return crypto.verify('sha384', data, { key, dsaEncoding: 'ieee-p1363' }, sig);
    if (alg === 'rsa-pss-sha512') return crypto.verify('sha512', data, { key, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 64 }, sig);
    if (alg === 'rsa-v1_5-sha256') return crypto.verify('sha256', data, key, sig);
    if (alg === 'ed25519') return crypto.verify(null, data, key, sig);
    return false;
  } catch (e) { return false; }
}
const sameSecret = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- point d'entrée ----------
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const c = conf(), q = req.query || {}, action = String(q.action || '');
  const send = (code, obj) => res.status(code).json(obj);
  let body;
  try {
    if (action === 'config') {
      return send(200, { enabled: c.ready, sandbox: c.sandbox, priceUSD: c.prices.USD,
        countries: Object.entries(COUNTRIES).map(([code, k]) => ({ code, name: k.name, prefix: k.prefix, currency: k.currency, amount: amountFor(c, code),
          providers: Object.entries(k.providers).map(([p, n]) => ({ code: p, name: n })) })) });
    }
    if (!c.ready) return send(501, { error: 'not_configured' });

    if (action === 'pay') {
      if (req.method !== 'POST') return send(405, { error: 'method' });
      const user = await currentUser(c, req); if (!user) return send(401, { error: 'auth' });
      body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const country = String(body && body.country || ''), provider = String(body && body.provider || '');
      if (!COUNTRIES[country] || !COUNTRIES[country].providers[provider]) return send(400, { error: 'bad_operator' });
      const phone = normPhone(country, body && body.phone); if (!phone) return send(400, { error: 'bad_phone' });
      // anti-doublon : un paiement déjà en attente depuis moins de 3 minutes, ou trop de tentatives
      const since = new Date(Date.now() - 10 * 60e3).toISOString();
      const recent = await sbFetch(c, `/rest/v1/music_premium_payments?user_id=eq.${user.id}&created_at=gte.${encodeURIComponent(since)}&select=id,status,created_at&order=created_at.desc`);
      const open = (recent || []).find(p => p.status === 'pending' && Date.now() - Date.parse(p.created_at) < 3 * 60e3);
      if (open) return send(409, { error: 'pending', id: open.id });
      if ((recent || []).length >= 5) return send(429, { error: 'too_many' });
      const id = crypto.randomUUID(), currency = COUNTRIES[country].currency, amount = amountFor(c, country);
      await sbFetch(c, '/rest/v1/music_premium_payments', { method: 'POST', prefer: 'return=minimal', body: {
        id, user_id: user.id, provider: 'pawapay', operator: provider, country, phone_hint: phone.slice(0, 4) + '•••••' + phone.slice(-3), amount: Number(amount), currency, months: 1 } });
      const r = await pp(c, '/v2/deposits', { method: 'POST', body: {
        depositId: id, amount, currency, payer: { type: 'MMO', accountDetails: { phoneNumber: phone, provider } },
        customerMessage: 'WMA MUSIC Premium', clientReferenceId: 'WMA-' + user.id.slice(0, 8), metadata: [{ userId: user.id }, { product: 'premium-1-month' }] } });
      const st = r.json && r.json.status;
      if (st === 'ACCEPTED' || st === 'DUPLICATE_IGNORED') return send(200, { id, status: 'pending' });
      if (st === 'REJECTED') {
        const code = String((r.json.failureReason && r.json.failureReason.failureCode) || 'REJECTED');
        await rpc(c, 'music_premium_fail', { p_id: id, p_reason: code, p_raw: r.json });
        return send(402, { error: 'rejected', code, id });
      }
      return send(502, { error: 'provider_unreachable', id });            // reste « en attente » : sera revérifié
    }

    if (action === 'status') {
      const user = await currentUser(c, req); if (!user) return send(401, { error: 'auth' });
      const id = String(q.id || ''); if (!UUID.test(id)) return send(400, { error: 'bad_id' });
      let pay = await getPayment(c, id); if (!pay || pay.user_id !== user.id) return send(404, { error: 'not_found' });
      pay = await verifyWithPawaPay(c, pay);
      return send(200, publicPay(pay));
    }

    if (action === 'callback') {
      if (req.method !== 'POST') return send(405, { error: 'method' });
      if (!sameSecret(q.key || '', c.cbKey)) return send(403, { error: 'forbidden' });
      const raw = await rawBody(req);
      if (c.pubKey && !verifySignature(req, raw, c.pubKey)) return send(401, { error: 'bad_signature' });
      let b = {}; try { b = JSON.parse(raw || '{}'); } catch (e) { b = {}; }
      const id = String(b.depositId || ''); if (!UUID.test(id)) return send(200, { ok: true, ignored: true });
      const pay = await getPayment(c, id); if (!pay) return send(200, { ok: true, ignored: true });
      const after = await verifyWithPawaPay(c, pay);                     // revérification auprès de pawaPay
      return send(200, { ok: true, status: after && after.status });
    }

    if (action === 'download') {
      const user = await currentUser(c, req); if (!user) return send(401, { error: 'auth' });
      const prem = await sbFetch(c, '/rest/v1/rpc/music_is_premium', { method: 'POST', key: c.anon, auth: user.auth, body: {} });
      if (prem !== true) return send(403, { error: 'not_premium' });
      const tid = String(q.track || ''); if (!/^[A-Za-z0-9_-]{1,80}$/.test(tid)) return send(400, { error: 'bad_track' });
      const docs = await sbFetch(c, `/rest/v1/music_docs?kind=eq.tracks&id=eq.${encodeURIComponent(tid)}&select=data`);
      const t = docs && docs[0] && docs[0].data;
      const live = t && (t.status === 'published' || (t.status === 'scheduled' && t.publishAt && t.publishAt <= Date.now()));
      if (!live) return send(404, { error: 'not_found' });
      if (t.demo && !t.audioId && !t.audioUrl) return send(200, { demo: true });
      if (t.audioId && /^audio\//.test(t.audioId)) {
        const s = await sbFetch(c, '/storage/v1/object/sign/music-audio/' + t.audioId.split('/').map(encodeURIComponent).join('/'), { method: 'POST', body: { expiresIn: 900 } });
        const p = s && (s.signedURL || s.signedUrl); if (!p) return send(404, { error: 'no_file' });
        return send(200, { url: c.sbUrl + '/storage/v1' + (p.startsWith('/') ? p : '/' + p) });
      }
      if (t.audioUrl && /^https:\/\//.test(t.audioUrl)) return send(200, { url: t.audioUrl });
      return send(404, { error: 'no_file' });
    }

    if (action === 'reconcile') {
      const secret = process.env.CRON_SECRET || '';
      if (!secret || !sameSecret(String(req.headers.authorization || ''), 'Bearer ' + secret)) return send(403, { error: 'forbidden' });
      const old = new Date(Date.now() - 2 * 60e3).toISOString(), week = new Date(Date.now() - 7 * 864e5).toISOString();
      const list = await sbFetch(c, `/rest/v1/music_premium_payments?status=eq.pending&created_at=lte.${encodeURIComponent(old)}&created_at=gte.${encodeURIComponent(week)}&select=*&limit=50`);
      let done = 0; for (const p of list || []) { const a = await verifyWithPawaPay(c, p); if (a && a.status !== 'pending') done++; }
      return send(200, { checked: (list || []).length, settled: done });
    }
    return send(404, { error: 'unknown_action' });
  } catch (e) {
    console.error('premium', action, e && e.message);
    return send(500, { error: 'server' });
  }
};
