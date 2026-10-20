const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    if (!process.env.AUTH_SECRET) return res.status(500).json({ error: 'Authentication is not configured.' });
    const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => {
      const i = v.indexOf('='); return i < 0 ? [v, ''] : [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
    }));
    const token = cookies.nexora_session;
    if (!token) return res.status(401).json({ authenticated: false });
    const payload = jwt.verify(token, process.env.AUTH_SECRET);
    return res.status(200).json({ authenticated: true, user: { id: payload.sub, email: payload.email } });
  } catch {
    return res.status(401).json({ authenticated: false });
  }
};