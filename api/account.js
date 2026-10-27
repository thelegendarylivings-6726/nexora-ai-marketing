const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = global.__nexoraPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__nexoraPrisma = prisma;

function userIdFromCookie(req) {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('='); return i < 0 ? [v, ''] : [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
  }));
  if (!cookies.nexora_session || !process.env.AUTH_SECRET) return null;
  try { return jwt.verify(cookies.nexora_session, process.env.AUTH_SECRET).sub || null; } catch { return null; }
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required.' });
  const id = userIdFromCookie(req);
  if (!id) return res.status(401).json({ error: 'Please sign in to view your account usage.' });
  try {
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, trialStartedAt: true, coinBalance: true, dailyUsageSeconds: true, usageDate: true, cooldownUntil: true } });
    if (!user) return res.status(401).json({ error: 'Account not found. Please sign in again.' });
    const now = new Date();
    const trialEndsAt = new Date(user.trialStartedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const trialActive = now < trialEndsAt;
    const utcDate = now.toISOString().slice(0, 10);
    const used = user.usageDate === utcDate ? user.dailyUsageSeconds : 0;
    return res.status(200).json({
      user: { id: user.id, name: user.name, email: user.email },
      trial: { active: trialActive, startedAt: user.trialStartedAt, endsAt: trialEndsAt, remainingSeconds: Math.max(0, Math.floor((trialEndsAt - now) / 1000)) },
      usage: { usedSecondsToday: used, limitSecondsPerDay: 28800, remainingSecondsToday: Math.max(0, 28800 - used), cooldownUntil: user.cooldownUntil && user.cooldownUntil > now ? user.cooldownUntil : null, coins: user.coinBalance },
      billing: { coinPurchasesEnabled: false, note: 'Coin packs cannot be credited until a verified payment provider and webhook are configured.' }
    });
  } catch (e) { console.error('Account status error:', e); return res.status(503).json({ error: 'Account status is temporarily unavailable.' }); }
};
