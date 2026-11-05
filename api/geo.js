// WMA MUSIC — renvoie le pays de l'auditeur (code ISO à 2 lettres) déduit par Vercel de son adresse IP.
// Aucune adresse IP n'est conservée : seul le code pays est renvoyé à l'application.
module.exports = (req, res) => {
  const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase().slice(0, 2);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({ country: /^[A-Z]{2}$/.test(country) ? country : null }));
};
