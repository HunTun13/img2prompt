const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('../api/generate-prompt');

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

function createRequest() {
  return {
    method: 'POST',
    body: {
      imageData: 'data:image/png;base64,aGVsbG8=',
      format: 'general',
      detail: 'detailed',
      cfToken: 'test-turnstile-token',
    },
    headers: {},
    socket: {},
  };
}

async function withGeminiEnvironment(fetchImpl, run) {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalEnv = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  };

  global.fetch = fetchImpl;
  console.warn = () => {};
  console.error = () => {};
  process.env.GEMINI_API_KEY = 'test-api-key';
  delete process.env.GEMINI_BASE_URL;
  process.env.GEMINI_MODEL = 'gemini-3.5-flash';
  delete process.env.TURNSTILE_SECRET_KEY;

  try {
    await run();
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
    console.error = originalError;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('sends image analysis requests to the official Gemini native API', async () => {
  const calls = [];
  const result = {
    mainPrompt: 'A brass instrument on a table.',
    modelPrompt: 'brass instrument, studio light',
    negativePrompt: 'blurry',
    styleKeywords: ['studio'],
    lighting: 'soft studio light',
    camera: 'eye level',
    colorPalette: 'gold and brown',
  };

  await withGeminiEnvironment(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }, async () => {
    const response = createResponse();
    await handler(createRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.mainPrompt, result.mainPrompt);
  });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',
  );
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'test-api-key');
  assert.equal(calls[0].options.headers.Authorization, undefined);

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'image/png');
  assert.equal(body.contents[0].parts[0].inlineData.data, 'aGVsbG8=');
  assert.match(body.contents[0].parts[1].text, /expert AI image prompt engineer/);
});

test('returns a safe service error when Gemini is unavailable', async () => {
  await withGeminiEnvironment(async () => new Response(
    'No available accounts: private provider details',
    { status: 503 },
  ), async () => {
    const response = createResponse();
    await handler(createRequest(), response);

    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, {
      error: 'AI service is temporarily unavailable. Please try again.',
      code: 'UPSTREAM_UNAVAILABLE',
    });
    assert.doesNotMatch(JSON.stringify(response.body), /private provider details/);
  });
});
