/**
 * PromptFromImage — Cloudflare Worker
 * POST /api/generate-prompt
 *   body: { imageData, format, detail, cfToken }
 *   returns: { mainPrompt, modelPrompt, negativePrompt, styleKeywords, lighting, camera, colorPalette }
 *
 * Secrets to set via `wrangler secret put`:
 *   GEMINI_API_KEY        — Google AI Studio key
 *   TURNSTILE_SECRET_KEY  — Cloudflare Turnstile secret key
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
  general:
    "Use clear natural language. Cover subject, environment, style, mood, technical details.",
  midjourney:
    "Use concise style phrases separated by commas. End with --ar 16:9 --v 6 --style raw. Prioritize visual impact words.",
  flux:
    "Use flowing natural-language sentences. Avoid tag-heavy comma lists. Be descriptive and specific.",
  "stable-diffusion":
    "Use weighted parenthesis tags like (subject:1.3). For modelPrompt include both positive tags and a separate negative block.",
  "nano-banana":
    "Prioritize subject consistency and scene editability. Use: Subject + Environment + Style + Mood structure.",
  dalle:
    "Use clear descriptive paragraphs. State subject, scene, and style explicitly. No special syntax needed.",
  video:
    "Include: camera movement (slow push / orbit / tilt), subject motion, environmental dynamics, suggested duration.",
  json:
    "Make modelPrompt a stringified JSON with fields: subject, environment, style, lighting, camera, mood, colors.",
};

const DETAIL_GUIDE = {
  short:    "Keep everything concise. 1 sentence per field.",
  balanced: "Moderate detail. 2-3 key visual elements per field.",
  detailed: "Maximum detail. Cover every visual element: subject, material, texture, environment, lighting, atmosphere, camera, style, mood.",
};

function buildPrompt(format, detail) {
  const modelInstr  = MODEL_GUIDE[format]  || MODEL_GUIDE.general;
  const detailInstr = DETAIL_GUIDE[detail] || DETAIL_GUIDE.detailed;
  return [
    BASE_SYSTEM,
    "",
    `Target model format: ${format.toUpperCase()}`,
    `Model instruction: ${modelInstr}`,
    `Detail level: ${detail} — ${detailInstr}`,
    "",
    "Return this exact JSON structure (fill every field):",
    JSON_SCHEMA,
  ].join("\n");
}

/* ===== CORS HEADERS ===== */
const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/* ===== TURNSTILE VALIDATION ===== */
async function validateTurnstile(token, secretKey, clientIp) {
  if (!secretKey) {
    // No secret configured — allow in local dev
    console.warn("TURNSTILE_SECRET_KEY not set, skipping validation.");
    return true;
  }
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: secretKey, response: token, remoteip: clientIp || "" }),
  });
  const data = await res.json();
  return data.success === true;
}

/* ===== IMAGE PREPARATION ===== */
async function toInlineData(imageData) {
  if (imageData.startsWith("data:")) {
    // Base64 data URL from file upload
    const [header, base64] = imageData.split(",");
    const mimeType = header.match(/data:([^;]+)/)?.[1] || "image/jpeg";
    return { inlineData: { mimeType, data: base64 } };
  }
  // Remote URL — fetch and re-encode
  const res = await fetch(imageData, { cf: { cacheTtl: 60 } });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf  = await res.arrayBuffer();
  const b64  = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { inlineData: { mimeType: mime, data: b64 } };
}

/* ===== GEMINI CALL ===== */
async function callGemini(imagePart, prompt, env) {
  const baseUrl = (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const model   = env.GEMINI_MODEL   || 'gemini-2.0-flash';
  const apiKey  = env.GEMINI_API_KEY;
  const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [{ text: prompt }, imagePart] }],
    generationConfig: {
      temperature:      0.4,
      maxOutputTokens:  1200,
      responseMimeType: "application/json",
    },
  };

  const res  = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");
  return text;
}

/* ===== PARSE & NORMALISE RESULT ===== */
function parseResult(raw, format) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found in AI response");
    obj = JSON.parse(match[0]);
  }

  // Normalise styleKeywords to array
  if (typeof obj.styleKeywords === "string") {
    obj.styleKeywords = obj.styleKeywords.split(",").map((s) => s.trim()).filter(Boolean);
  }
  obj.format = format;
  return obj;
}

/* ===== MAIN HANDLER ===== */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Route guard
    if (request.method !== "POST" || !url.pathname.endsWith("/generate-prompt")) {
      return new Response("Not found", { status: 404, headers: CORS });
    }

    try {
      const { imageData, format, detail, cfToken } = await request.json();

      // Input validation
      if (!imageData || !format || !detail || !cfToken) {
        return jsonRes({ error: "Missing required fields: imageData, format, detail, cfToken" }, 400);
      }
      if (imageData.length > 12 * 1024 * 1024) {
        return jsonRes({ error: "Image too large (max 10 MB)" }, 413);
      }

      // Turnstile verification
      const clientIp = request.headers.get("CF-Connecting-IP");
      const valid = await validateTurnstile(cfToken, env.TURNSTILE_SECRET_KEY, clientIp);
      if (!valid) {
        return jsonRes({ error: "Human verification failed. Please refresh and try again." }, 403);
      }

      // Prepare image + prompt
      const [imagePart, prompt] = await Promise.all([
        toInlineData(imageData),
        Promise.resolve(buildPrompt(format, detail)),
      ]);

      // Call Gemini
      const raw    = await callGemini(imagePart, prompt, env);
      const result = parseResult(raw, format);

      return jsonRes(result);

    } catch (err) {
      console.error("[worker error]", err.message);
      return jsonRes({ error: "Server error. Please try again." }, 500);
    }
  },
};
