const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const prisma = global.__nexoraPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__nexoraPrisma = prisma;
const DAILY_LIMIT = 8 * 60 * 60;
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const MAX_HEARTBEAT_SECONDS = 90;

function userIdFromCookie(req) {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('='); return i < 0 ? [v, ''] : [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
  }));
  if (!cookies.nexora_session || !process.env.AUTH_SECRET) return null;
  try { return jwt.verify(cookies.nexora_session, process.env.AUTH_SECRET).sub || null; } catch { return null; }
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required.' });
  const id = userIdFromCookie(req);
  if (!id) return res.status(401).json({ error: 'Please sign in before starting a usage session.' });
  const action = String(req.body?.action || '');
  if (!['start', 'heartbeat', 'stop'].includes(action)) return res.status(400).json({ error: 'Unsupported usage action.' });
  try {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const result = await prisma.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id } });
      if (!user) return { status: 401, body: { error: 'Account not found. Please sign in again.' } };
      if (now.getTime() >= user.trialStartedAt.getTime() + 7 * 24 * 60 * 60 * 1000) {
        return { status: 403, body: { error: 'Your 7-day free trial has ended.' } };
      }
      if (user.cooldownUntil && user.cooldownUntil > now) {
        return { status: 429, body: { error: 'Daily usage limit reached. Cooldown is active.', cooldownUntil: user.cooldownUntil } };
      }
      let used = user.usageDate === date ? user.dailyUsageSeconds : 0;
      let active = user.activeUsageStartedAt;
      if (active) {
        const elapsed = Math.max(0, Math.min(MAX_HEARTBEAT_SECONDS, Math.floor((now - active) / 1000)));
        used = Math.min(DAILY_LIMIT, used + elapsed);
        active = null;
      }
      let cooldownUntil = user.cooldownUntil && user.cooldownUntil > now ? user.cooldownUntil : null;
      if (used >= DAILY_LIMIT) cooldownUntil = new Date(now.getTime() + COOLDOWN_MS);
      if (action === 'start' || action === 'heartbeat') {
        if (cooldownUntil) {
          await tx.user.update({ where: { id }, data: { dailyUsageSeconds: used, usageDate: date, activeUsageStartedAt: null, cooldownUntil } });
          return { status: 429, body: { error: 'Daily usage limit reached. Cooldown is active.', cooldownUntil } };
        }
        active = now;
      }
      await tx.user.update({ where: { id }, data: { dailyUsageSeconds: used, usageDate: date, activeUsageStartedAt: active, cooldownUntil } });
      return { status: 200, body: { ok: true, action, usedSecondsToday: used, remainingSecondsToday: Math.max(0, DAILY_LIMIT - used), cooldownUntil } };
    });
    return res.status(result.status).json(result.body);
  } catch (e) { console.error('Usage tracking error:', e); return res.status(503).json({ error: 'Usage tracking is temporarily unavailable.' }); }
};
