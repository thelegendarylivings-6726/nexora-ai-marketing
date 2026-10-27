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

  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) return send(res, 503, { error: "AI is not connected yet. Add AI Gateway authentication securely in Vercel project settings." });

  const system = `You are Nexora Build Studio, a senior web designer and front-end engineer. Generate a complete, polished, original website from the user's request. Return ONLY a complete HTML document beginning <!doctype html> and ending </html>. No markdown fences, explanations, placeholders like lorem ipsum, or external framework/build step. Use semantic HTML, excellent responsive CSS, modern visual hierarchy, high-quality original inline SVG/CSS visuals, smooth but restrained animation, accessible labels/focus states, mobile navigation if needed, and useful realistic copy. The website must feel custom to the brief, not like a generic template. If the user requests 3D, create a convincing CSS 3D scene and interactive controls; do not claim a real Three.js model or real video generation unless actually implemented. Add working client-side interactions where appropriate. Forms must clearly state they are demos and must not pretend to send data. Do not include external API secrets, tracking, malicious code, data exfiltration, or requests for sensitive information. All functionality should run as a standalone HTML file. Keep the output under about 28,000 characters. Use accent color ${accent}. Design direction: ${style}. Return valid HTML only.`;

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
