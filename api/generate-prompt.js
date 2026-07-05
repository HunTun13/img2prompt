/**
 * Vercel Serverless Function
 * Route: /api/generate-prompt  (POST)
 *
 * Set these in Vercel Dashboard → Project → Settings → Environment Variables:
 *   GEMINI_API_KEY
 *   GEMINI_BASE_URL   (e.g. https://aicode.cat)
 *   GEMINI_MODEL      (e.g. gemini-2.0-flash)
 *   TURNSTILE_SECRET_KEY
 */

/* ===== PROMPT TEMPLATES ===== */
const BASE_SYSTEM = `You are an expert AI image prompt engineer.
Analyze the provided image and generate a high-quality prompt to recreate a visually similar image.
Do NOT claim this is the original prompt — generate the best reusable equivalent.
Return ONLY a valid JSON object, no markdown fences, no explanation.`;

const JSON_SCHEMA = `{
  "mainPrompt": "detailed natural-language description covering subject, scene, style, lighting, composition, mood",
  "modelPrompt": "prompt rewritten for the specified model using its preferred syntax",
  "negativePrompt": "comma-separated list of unwanted elements",
  "styleKeywords": ["keyword1", "keyword2"],
  "lighting": "lighting style and quality description",
  "camera": "framing, angle, lens, depth of field, composition",
  "colorPalette": "main colors and tones in the image"
}`;

const MODEL_GUIDE = {
  general:            "Use clear natural language. Cover subject, environment, style, mood, technical details.",
  midjourney:         "Use concise style phrases separated by commas. End with --ar 16:9 --v 6 --style raw.",
  flux:               "Use flowing natural-language sentences. Avoid tag-heavy comma lists.",
  "stable-diffusion": "Use weighted parenthesis tags like (subject:1.3). Include positive and negative blocks.",
  "nano-banana":      "Prioritize subject consistency. Use: Subject + Environment + Style + Mood structure.",
  dalle:              "Use clear descriptive paragraphs. State subject, scene, and style explicitly.",
  video:              "Include camera movement, subject motion, environmental dynamics, suggested duration.",
  json:               "Make modelPrompt a stringified JSON with fields: subject, environment, style, lighting, camera, mood, colors.",
};

const DETAIL_GUIDE = {
  short:    "Keep everything concise. 1 sentence per field.",
  balanced: "Moderate detail. 2-3 key visual elements per field.",
  detailed: "Maximum detail. Cover every visual element: subject, texture, environment, lighting, camera, style, mood.",
};

function buildPrompt(format, detail) {
  return [
    BASE_SYSTEM, "",
    `Target model format: ${format.toUpperCase()}`,
    `Model instruction: ${MODEL_GUIDE[format] || MODEL_GUIDE.general}`,
    `Detail level: ${detail} — ${DETAIL_GUIDE[detail] || DETAIL_GUIDE.detailed}`,
    "", "Return this exact JSON structure (fill every field):", JSON_SCHEMA,
  ].join("\n");
}

/* ===== TURNSTILE ===== */
async function validateTurnstile(token, clientIp) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) { console.warn("TURNSTILE_SECRET_KEY not set — skipping"); return true; }
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: secretKey, response: token, remoteip: clientIp || "" }),
  });
  return (await res.json()).success === true;
}

/* ===== IMAGE PREP ===== */
async function toInlineData(imageData) {
  if (imageData.startsWith("data:")) {
    const [header, base64] = imageData.split(",");
    const mimeType = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    return { inlineData: { mimeType, data: base64 } };
  }
  const res = await fetch(imageData);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  // Use Buffer in Node.js environment
  const buf    = Buffer.from(await res.arrayBuffer());
  const base64 = buf.toString("base64");
  const mime   = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { inlineData: { mimeType: mime, data: base64 } };
}

/* ===== GEMINI ===== */
async function callGemini(imagePart, prompt) {
  const base  = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const key   = process.env.GEMINI_API_KEY;
  const url   = `${base}/v1beta/models/${model}:generateContent?key=${key}`;

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, imagePart] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 1200, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");
  return text;
}

/* ===== PARSE ===== */
function parseResult(raw, format) {
  let obj;
  try { obj = JSON.parse(raw); }
  catch { const m = raw.match(/\{[\s\S]*\}/); if (!m) throw new Error("No JSON in response"); obj = JSON.parse(m[0]); }
  if (typeof obj.styleKeywords === "string")
    obj.styleKeywords = obj.styleKeywords.split(",").map(s => s.trim()).filter(Boolean);
  obj.format = format;
  return obj;
}

/* ===== HANDLER ===== */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(404).json({ error: "Not found" });

  try {
    const { imageData, format, detail, cfToken } = req.body;

    if (!imageData || !format || !detail || !cfToken)
      return res.status(400).json({ error: "Missing required fields" });
    if (imageData.length > 12 * 1024 * 1024)
      return res.status(413).json({ error: "Image too large (max 10 MB)" });

    const clientIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
    if (!await validateTurnstile(cfToken, clientIp))
      return res.status(403).json({ error: "Human verification failed. Please refresh and try again." });

    const imagePart = await toInlineData(imageData);
    const prompt    = buildPrompt(format, detail);
    const raw       = await callGemini(imagePart, prompt);
    const result    = parseResult(raw, format);

    return res.status(200).json(result);
  } catch (err) {
    console.error("[api error]", err.message);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
}
