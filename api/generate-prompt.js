/**
 * Vercel Serverless Function
 * Route: /api/generate-prompt  (POST)
 *
 * Set these in Vercel Dashboard → Project → Settings → Environment Variables:
 *   AI_GATEWAY_MODEL  (optional, defaults to google/gemini-2.5-flash-lite)
 *   TURNSTILE_SECRET_KEY
 *
 * Vercel automatically provides VERCEL_OIDC_TOKEN for AI Gateway authentication.
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
  const model = process.env.AI_GATEWAY_MODEL || "google/gemini-2.5-flash-lite";
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) throw new Error("Vercel AI Gateway authentication is not available");

  const imageContent = {
    type: "image_url",
    image_url: {
      url: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
      detail: "high",
    },
  };

  const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [imageContent, { type: "text", text: prompt }],
      }],
      max_tokens: 1200,
      temperature: 0.4,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "image_prompt",
          strict: true,
          schema: {
            type: "object",
            properties: {
              mainPrompt: { type: "string" },
              modelPrompt: { type: "string" },
              negativePrompt: { type: "string" },
              styleKeywords: { type: "array", items: { type: "string" } },
              lighting: { type: "string" },
              camera: { type: "string" },
              colorPalette: { type: "string" },
            },
            required: [
              "mainPrompt", "modelPrompt", "negativePrompt", "styleKeywords",
              "lighting", "camera", "colorPalette",
            ],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[gateway error] ${res.status}: ${errText.slice(0, 300)}`);
    const error = new Error(`AI Gateway returned ${res.status}`);
    error.code = "UPSTREAM_UNAVAILABLE";
    throw error;
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`Empty API response: ${JSON.stringify(data).slice(0, 200)}`);
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
    if (err.code === "UPSTREAM_UNAVAILABLE") {
      return res.status(502).json({
        error: "AI service is temporarily unavailable. Please try again.",
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    return res.status(500).json({ error: "Server error. Please try again." });
  }
}
