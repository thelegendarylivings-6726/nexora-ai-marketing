const MODEL = "alibaba/qwen3-coder-30b-a3b";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use POST for website generation." });
  }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const style = typeof body?.style === "string" ? body.style : "auto";
  const accent = typeof body?.accent === "string" && /^#[0-9a-fA-F]{6}$/.test(body.accent) ? body.accent : "#68e7ff";
  if (!prompt) return send(res, 400, { error: "Enter a website prompt first." });
  if (prompt.length > 12000) return send(res, 413, { error: "Prompt is too long. Keep it under 12,000 characters." });
  if (!["auto", "cinema", "3d", "business", "store", "portfolio"].includes(style)) return send(res, 400, { error: "Choose one of the supported design styles." });

  // Enforce account trial and an active, server-tracked usage session before AI generation.
  const jwt = require("jsonwebtoken");
  const { PrismaClient } = require("@prisma/client");
  const prisma = global.__nexoraPrisma || new PrismaClient();
  if (process.env.NODE_ENV !== "production") global.__nexoraPrisma = prisma;
  const cookies = Object.fromEntries(String(req.headers.cookie || "").split(";").map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf("="); return i < 0 ? [v, ""] : [v.slice(0, i), decodeURIComponent(v.slice(i + 1))];
  }));
  let accountId = null;
  try { if (cookies.nexora_session && process.env.AUTH_SECRET) accountId = jwt.verify(cookies.nexora_session, process.env.AUTH_SECRET).sub || null; } catch {}
  if (!accountId) return send(res, 401, { error: "Sign in to use the AI builder. Your trial and daily usage are tracked on your account." });
  try {
    const account = await prisma.user.findUnique({ where: { id: accountId } });
    if (!account) return send(res, 401, { error: "Account not found. Please sign in again." });
    const now = new Date();
    if (now.getTime() >= account.trialStartedAt.getTime() + 7 * 24 * 60 * 60 * 1000) return send(res, 403, { error: "Your 7-day free trial has ended." });
    if (account.cooldownUntil && account.cooldownUntil > now) return send(res, 429, { error: "Daily usage limit reached. Cooldown is active until " + account.cooldownUntil.toISOString() + "." });
    const utcDate = now.toISOString().slice(0, 10);
    const used = account.usageDate === utcDate ? account.dailyUsageSeconds : 0;
    if (used >= 28800) return send(res, 429, { error: "Daily usage limit reached. Your 2-hour cooldown is required." });
    if (!account.activeUsageStartedAt || now.getTime() - account.activeUsageStartedAt.getTime() > 120000) return send(res, 429, { error: "Usage session is not active. Keep Build Studio open while signed in and retry." });
  } catch (e) {
    console.error("Generation account check failed:", e);
    return send(res, 503, { error: "Account and usage checks are temporarily unavailable. No generation was started." });
  }

  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) return send(res, 503, { error: "AI is not connected yet. Add AI Gateway authentication securely in Vercel project settings." });

  const system = `You are Nexora Build Studio, a senior web designer and front-end engineer. Generate a complete, polished, original website from the user's request. Return ONLY a complete HTML document beginning <!doctype html> and ending </html>. No markdown fences, explanations, placeholders like lorem ipsum, or external framework/build step. Use semantic HTML, excellent responsive CSS, modern visual hierarchy, high-quality original inline SVG/CSS visuals, smooth but restrained animation, accessible labels/focus states, mobile navigation if needed, and useful realistic copy. The website must feel custom to the brief, not like a generic template. If the user requests real 3D, you may use a pinned Three.js script from a reputable CDN and build an interactive WebGL scene with camera/lighting/animation; include a CSS fallback if WebGL or the CDN is unavailable. Distinguish real WebGL from CSS-only effects. For cinematic briefs, create layered composition, dramatic lighting, motion and strong typography. Do not claim actual video generation unless a video asset exists. Add working client-side interactions where appropriate. Forms must clearly state they are demos and must not pretend to send data. Do not include external API secrets, tracking, malicious code, data exfiltration, or requests for sensitive information. All functionality should run as a standalone HTML file. Keep the output under about 38,000 characters. Use accent color ${accent}. Design direction: ${style}. Return valid HTML only.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 85000);
    let upstream;
    try {
      upstream = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://nexora-onecore.vercel.app/build-studio.html",
          "X-Title": "Nexora Build Studio"
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: "Build this website from scratch based on the following brief. Make it highly visual and specific.\\n\\n" + prompt }
          ],
          temperature: 0.65,
          max_tokens: 10000
        }),
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = upstream.status;
      if (status === 401) return send(res, 503, { error: "AI Gateway authentication is not configured correctly. Set up AI Gateway/OIDC in Vercel." });
      if (status === 402 || status === 403) return send(res, 503, { error: "AI Gateway needs account verification or available credits. No payment or account setting was changed by this app." });
      if (status === 429) return send(res, 429, { error: "AI generation is temporarily rate-limited. Please try again shortly." });
      return send(res, 502, { error: "The AI provider could not complete this generation. Please try again." });
    }
    let html = data?.choices?.[0]?.message?.content;
    if (Array.isArray(html)) html = html.map(part => part?.text || "").join("");
    if (typeof html !== "string") return send(res, 502, { error: "The AI response did not contain website HTML." });
    html = html.trim().replace(/^\`\`\`(?:html)?\s*/i, "").replace(/\s*\`\`\`$/, "");
    const start = html.toLowerCase().indexOf("<!doctype html");
    const altStart = html.toLowerCase().indexOf("<html");
    const index = start >= 0 ? start : altStart;
    if (index > 0) html = html.slice(index);
    if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) return send(res, 502, { error: "The AI returned incomplete HTML. Please regenerate." });
    if (html.length > 45000) return send(res, 502, { error: "The generated website exceeded the size limit. Try a more focused prompt." });
    return send(res, 200, { html, model: MODEL, mode: "ai" });
  } catch (error) {
    if (error?.name === "AbortError") return send(res, 504, { error: "AI generation took too long. Try a shorter or simpler prompt." });
    return send(res, 502, { error: "Could not reach the AI generation service. Try again later." });
  }
};
