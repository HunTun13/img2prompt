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

async function withGatewayEnvironment(fetchImpl, run) {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalEnv = {
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
    AI_GATEWAY_MODEL: process.env.AI_GATEWAY_MODEL,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  };

  global.fetch = fetchImpl;
  console.warn = () => {};
  console.error = () => {};
  delete process.env.AI_GATEWAY_API_KEY;
  process.env.VERCEL_OIDC_TOKEN = 'test-oidc-token';
  delete process.env.AI_GATEWAY_MODEL;
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

test('uses Vercel AI Gateway with automatic OIDC authentication', async () => {
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

  await withGatewayEnvironment(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(result) } }],
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
    'https://ai-gateway.vercel.sh/v1/chat/completions',
  );
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-oidc-token');
  assert.equal(calls[0].options.headers['x-goog-api-key'], undefined);

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'google/gemini-2.5-flash-lite');
  assert.equal(body.messages[0].content[0].type, 'image_url');
  assert.equal(body.messages[0].content[0].image_url.url, 'data:image/png;base64,aGVsbG8=');
  assert.match(body.messages[0].content[1].text, /expert AI image prompt engineer/);
});

test('returns a safe service error when Gemini is unavailable', async () => {
  await withGatewayEnvironment(async () => new Response(
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
