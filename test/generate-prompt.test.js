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

async function withGatewayEnvironment(fetchImpl, run, overrides = {}) {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalEnv = {
    AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY,
    VERCEL_OIDC_TOKEN: process.env.VERCEL_OIDC_TOKEN,
    AI_GATEWAY_MODEL: process.env.AI_GATEWAY_MODEL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
  };

  global.fetch = fetchImpl;
  console.warn = () => {};
  console.error = () => {};
  delete process.env.AI_GATEWAY_API_KEY;
  process.env.VERCEL_OIDC_TOKEN = 'test-oidc-token';
  delete process.env.AI_GATEWAY_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_BASE_URL;
  delete process.env.GEMINI_MODEL;
  delete process.env.TURNSTILE_SECRET_KEY;
  Object.assign(process.env, overrides);

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

test('uses the configured OpenAI-compatible third-party route first', async () => {
  const calls = [];
  const result = {
    mainPrompt: 'Third-party image description.',
    modelPrompt: 'third-party prompt',
    negativePrompt: 'blurry',
    styleKeywords: ['photo'],
    lighting: 'daylight',
    camera: 'close-up',
    colorPalette: 'neutral',
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
  }, {
    GEMINI_API_KEY: 'third-party-key',
    GEMINI_BASE_URL: 'https://aicode.cat',
    GEMINI_MODEL: 'vision-model',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://aicode.cat/v1/chat/completions');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer third-party-key');
  assert.equal(JSON.parse(calls[0].options.body).model, 'vision-model');
});

test('falls back to Vercel AI Gateway when the third-party route is unavailable', async () => {
  const calls = [];
  const fallbackResult = {
    mainPrompt: 'Fallback image description.',
    modelPrompt: 'fallback prompt',
    negativePrompt: 'blurry',
    styleKeywords: ['photo'],
    lighting: 'daylight',
    camera: 'close-up',
    colorPalette: 'neutral',
  };

  await withGatewayEnvironment(async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('https://aicode.cat')) {
      return new Response('No available accounts', { status: 503 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(fallbackResult) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }, async () => {
    const response = createResponse();
    await handler(createRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.mainPrompt, fallbackResult.mainPrompt);
  }, {
    GEMINI_API_KEY: 'third-party-key',
    GEMINI_BASE_URL: 'https://aicode.cat',
    GEMINI_MODEL: 'vision-model',
  });

  assert.deepEqual(calls.map(call => call.url), [
    'https://aicode.cat/v1/chat/completions',
    'https://ai-gateway.vercel.sh/v1/chat/completions',
  ]);
});

test('reports provider readiness without exposing credentials', async () => {
  await withGatewayEnvironment(async () => {
    throw new Error('health check must not call an upstream service');
  }, async () => {
    const response = createResponse();
    await handler({ method: 'GET', headers: {}, socket: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      status: 'ok',
      thirdPartyConfigured: false,
      gatewayAuthConfigured: true,
      gatewayModel: 'google/gemini-2.5-flash-lite',
    });
    assert.doesNotMatch(JSON.stringify(response.body), /test-oidc-token|api-key|secret/i);
  });
});

test('probes configured third-party model IDs without exposing its key', async () => {
  const calls = [];
  await withGatewayEnvironment(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      data: [
        { id: 'gemini-2.0-flash' },
        { id: 'gpt-4.1-mini' },
        { id: '<script>bad</script>' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }, async () => {
    const response = createResponse();
    await handler({
      method: 'GET',
      query: { probe: 'third-party-models' },
      headers: {},
      socket: {},
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      status: 'ok',
      providerStatus: 200,
      models: ['gemini-2.0-flash', 'gpt-4.1-mini'],
    });
    assert.equal(calls[0].url, 'https://aicode.cat/v1/models');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer third-party-key');
    assert.doesNotMatch(JSON.stringify(response.body), /third-party-key/);
  }, {
    GEMINI_API_KEY: 'third-party-key',
    GEMINI_BASE_URL: 'https://aicode.cat',
    GEMINI_MODEL: 'vision-model',
  });
});
