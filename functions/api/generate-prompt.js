/**
 * Cloudflare Pages Function
 * Route: /api/generate-prompt  (POST)
 * File:  functions/api/generate-prompt.js
 *
 * Secrets (set via Dashboard or CLI):
 *   wrangler pages secret put GEMINI_API_KEY      --project-name img2prompt
 *   wrangler pages secret put GEMINI_BASE_URL     --project-name img2prompt
 *   wrangler pages secret put GEMINI_MODEL        --project-name img2prompt
 *   wrangler pages secret put TURNSTILE_SECRET_KEY --project-name img2prompt
 */

/* ===== PROMPT TEMPLATES ===== */
const BASE_SYSTEM = `You are an expert AI image prompt engineer.
Analyze the provided image and generate a high-quality prompt to recreate a visually similar image.
Do NOT claim this is the original prompt — generate the best reusable equivalent.
Base every field on visible evidence. Do not guess a person's identity, a brand, or unreadable text.
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
  general:           "Use clear natural language. Cover subject, environment, style, mood, technical details.",
  midjourney:        "Use concise descriptive phrases separated by commas. Infer an appropriate --ar value from the image. Add --raw only when a less opinionated result helps. Put exclusions in a short --no parameter when useful. Do not add a --v version flag.",
  flux:              "Use flowing natural-language sentences. Avoid tag-heavy comma lists. Be descriptive and specific.",
  "stable-diffusion":"Use weighted parenthesis tags like (subject:1.3). For modelPrompt include both positive tags and a separate negative block.",
  "nano-banana":     "Write a direct natural-language edit instruction. Preserve the subject's identity and defining features. State the requested change, the surrounding context, and what must not change. For pure recreation, describe the subject, environment, composition, lighting, and style without inventing details.",
  dalle:             "Use clear descriptive paragraphs. State subject, scene, and style explicitly. No special syntax needed.",
  video:             "Treat the image as the starting frame. Describe one clear camera move, subject motion, environmental motion, timing, and the intended end state. Keep motion physically coherent and avoid abrupt cuts or unrelated scene changes.",
  json:              "Make modelPrompt a stringified JSON with fields: subject, environment, style, lighting, camera, mood, colors.",
};

const DETAIL_GUIDE = {
  short:    "Keep everything concise. 1 sentence per field.",
  balanced: "Moderate detail. 2-3 key visual elements per field.",
  detailed: "Maximum detail. Cover every visual element: subject, material, texture, environment, lighting, atmosphere, camera, style, mood.",
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

/* ===== CORS ===== */
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...CORS },
  });
}

/* ===== TURNSTILE ===== */
async function validateTurnstile(token, secretKey, clientIp) {
  if (!secretKey) { console.warn("TURNSTILE_SECRET_KEY not set — skipping in dev"); return true; }
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
  const res  = await fetch(imageData);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf  = await res.arrayBuffer();
  const b64  = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { inlineData: { mimeType: mime, data: b64 } };
}

/* ===== GEMINI ===== */
async function callGemini(imagePart, prompt, env) {
  const base = (env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  const url   = `${base}/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
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
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { imageData, format, detail, cfToken } = await request.json();
    if (!imageData || !format || !detail || !cfToken)
      return jsonRes({ error: "Missing required fields" }, 400);
    if (imageData.length > 12 * 1024 * 1024)
      return jsonRes({ error: "Image too large (max 10 MB)" }, 413);

    const ip = request.headers.get("CF-Connecting-IP");
    if (!await validateTurnstile(cfToken, env.TURNSTILE_SECRET_KEY, ip))
      return jsonRes({ error: "Human verification failed. Please refresh and try again." }, 403);

    const [imagePart] = await Promise.all([toInlineData(imageData)]);
    const prompt = buildPrompt(format, detail);
    const raw    = await callGemini(imagePart, prompt, env);
    const result = parseResult(raw, format);
    return jsonRes(result);
  } catch (err) {
    console.error("[pages fn error]", err.message);
    return jsonRes({ error: "Server error. Please try again." }, 500);
  }
}
