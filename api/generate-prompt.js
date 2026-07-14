/**
 * Vercel Serverless Function
 * Route: /api/generate-prompt  (POST)
 *
 * Set these in Vercel Dashboard → Project → Settings → Environment Variables:
 *   AI_GATEWAY_MODEL  (optional, defaults to google/gemini-2.5-flash-lite)
 *   TURNSTILE_SECRET_KEY
 *
 * Optional OpenAI-compatible provider (tried before AI Gateway):
 *   GEMINI_API_KEY
 *   GEMINI_BASE_URL
 *   GEMINI_MODEL
 *
 * Vercel automatically provides VERCEL_OIDC_TOKEN for AI Gateway authentication.
 */

const dns = require("node:dns").promises;
const net = require("node:net");

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REMOTE_REDIRECTS = 3;
const REMOTE_FETCH_TIMEOUT_MS = 8000;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SUPPORTED_FORMATS = new Set(["general", "midjourney", "flux", "stable-diffusion", "nano-banana", "dalle", "video", "json"]);
const SUPPORTED_DETAILS = new Set(["short", "balanced", "detailed"]);

class ClientInputError extends Error {
  constructor(statusCode, code, safeMessage) {
    super(safeMessage);
    this.statusCode = statusCode;
    this.code = code;
    this.safeMessage = safeMessage;
  }
}

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
  general:            "Use clear natural language. Cover subject, environment, style, mood, technical details.",
  midjourney:         "Use concise descriptive phrases separated by commas. Infer an appropriate --ar value from the image. Add --raw only when a less opinionated result helps. Put exclusions in a short --no parameter when useful. Do not add a --v version flag.",
  flux:               "Use flowing natural-language sentences. Avoid tag-heavy comma lists.",
  "stable-diffusion": "Use weighted parenthesis tags like (subject:1.3). Include positive and negative blocks.",
  "nano-banana":      "Write a direct natural-language edit instruction. Preserve the subject's identity and defining features. State the requested change, the surrounding context, and what must not change. For pure recreation, describe the subject, environment, composition, lighting, and style without inventing details.",
  dalle:              "Use clear descriptive paragraphs. State subject, scene, and style explicitly.",
  video:              "Treat the image as the starting frame. Describe one clear camera move, subject motion, environmental motion, timing, and the intended end state. Keep motion physically coherent and avoid abrupt cuts or unrelated scene changes.",
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
function isPrivateIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

function invalidImageUrl() {
  return new ClientInputError(400, "INVALID_IMAGE_URL", "Please use a public image URL.");
}

async function validatePublicImageUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalidImageUrl();
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw invalidImageUrl();
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw invalidImageUrl();
  }

  let addresses;
  if (net.isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await dns.lookup(hostname, { all: true, verbatim: true })).map(result => result.address);
    } catch {
      throw invalidImageUrl();
    }
  }

  if (!addresses.length || addresses.some(isPrivateIp)) throw invalidImageUrl();
  return url;
}

async function readLimitedBody(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
    throw new ClientInputError(413, "IMAGE_TOO_LARGE", "Image too large (max 10 MB).");
  }

  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new ClientInputError(413, "IMAGE_TOO_LARGE", "Image too large (max 10 MB).");
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new ClientInputError(413, "IMAGE_TOO_LARGE", "Image too large (max 10 MB).");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function fetchRemoteImage(imageUrl) {
  let currentUrl = await validatePublicImageUrl(imageUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REMOTE_REDIRECTS; redirectCount += 1) {
    let response;
    try {
      response = await fetch(currentUrl.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
        headers: {
          Accept: "image/jpeg,image/png,image/webp",
          "User-Agent": "Img2Prompt/1.0",
        },
      });
    } catch {
      throw new ClientInputError(400, "IMAGE_FETCH_FAILED", "We could not download that image URL.");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REMOTE_REDIRECTS) throw invalidImageUrl();
      currentUrl = await validatePublicImageUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new ClientInputError(400, "IMAGE_FETCH_FAILED", "We could not download that image URL.");
    }

    const mimeType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
      throw new ClientInputError(415, "UNSUPPORTED_IMAGE_TYPE", "The URL must point to a JPG, PNG, or WebP image.");
    }

    const buffer = await readLimitedBody(response);
    return { inlineData: { mimeType, data: buffer.toString("base64") } };
  }

  throw invalidImageUrl();
}

async function toInlineData(imageData) {
  if (imageData.startsWith("data:")) {
    const [header, base64] = imageData.split(",");
    const mimeType = header.match(/^data:([^;]+);base64$/i)?.[1]?.toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.has(mimeType) || !base64) {
      throw new ClientInputError(415, "UNSUPPORTED_IMAGE_TYPE", "Please upload a JPG, PNG, or WebP image.");
    }
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new ClientInputError(413, "IMAGE_TOO_LARGE", "Image too large (max 10 MB).");
    }
    return { inlineData: { mimeType, data: buffer.toString("base64") } };
  }
  return fetchRemoteImage(imageData);
}

/* ===== GEMINI ===== */
async function requestVisionCompletion({ endpoint, token, model, imagePart, prompt, responseFormat, label }) {
  const imageContent = {
    type: "image_url",
    image_url: {
      url: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
      detail: "high",
    },
  };

  const res = await fetch(endpoint, {
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
      response_format: responseFormat,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[${label} error] ${res.status}: ${errText.slice(0, 300)}`);
    const error = new Error(`${label} returned ${res.status}`);
    error.code = "UPSTREAM_UNAVAILABLE";
    throw error;
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    const error = new Error(`Empty ${label} response`);
    error.code = "UPSTREAM_UNAVAILABLE";
    throw error;
  }
  return text;
}

async function callGemini(imagePart, prompt) {
  const thirdPartyKey = process.env.GEMINI_API_KEY;
  const thirdPartyBase = process.env.GEMINI_BASE_URL?.replace(/\/+$/, "");
  const configuredThirdPartyModel = process.env.GEMINI_MODEL;
  const thirdPartyModel = configuredThirdPartyModel === "gemini-2.0-flash"
    ? "gemini-3.5-flash"
    : configuredThirdPartyModel;

  if (thirdPartyKey && thirdPartyBase && thirdPartyModel) {
    const endpoint = thirdPartyBase.endsWith("/v1")
      ? `${thirdPartyBase}/chat/completions`
      : `${thirdPartyBase}/v1/chat/completions`;
    try {
      return await requestVisionCompletion({
        endpoint,
        token: thirdPartyKey,
        model: thirdPartyModel,
        imagePart,
        prompt,
        responseFormat: { type: "json_object" },
        label: "third-party API",
      });
    } catch (error) {
      console.warn(`[provider fallback] ${error.message}`);
    }
  }

  const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!gatewayToken) throw new Error("Vercel AI Gateway authentication is not available");

  return requestVisionCompletion({
    endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions",
    token: gatewayToken,
    model: process.env.AI_GATEWAY_MODEL || "google/gemini-2.5-flash-lite",
    imagePart,
    prompt,
    responseFormat: {
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
    label: "AI Gateway",
  });
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
    if (!SUPPORTED_FORMATS.has(format) || !SUPPORTED_DETAILS.has(detail)) {
      return res.status(400).json({
        error: "Please choose a supported prompt format and detail level.",
        code: "INVALID_OPTIONS",
      });
    }
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
    if (err instanceof ClientInputError) {
      return res.status(err.statusCode).json({
        error: err.safeMessage,
        code: err.code,
      });
    }
    if (err.code === "UPSTREAM_UNAVAILABLE") {
      return res.status(502).json({
        error: "AI service is temporarily unavailable. Please try again.",
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    return res.status(500).json({ error: "Server error. Please try again." });
  }
}
