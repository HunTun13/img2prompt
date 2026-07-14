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

function createRemoteImageRequest(imageData) {
  const request = createRequest();
  request.body.imageData = imageData;
  return request;
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

test('upgrades the unavailable legacy third-party model to a current vision model', async () => {
  const calls = [];
  const result = {
    mainPrompt: 'Current model image description.',
    modelPrompt: 'current model prompt',
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
  }, {
    GEMINI_API_KEY: 'third-party-key',
    GEMINI_BASE_URL: 'https://aicode.cat',
    GEMINI_MODEL: 'gemini-2.0-flash',
  });

  assert.equal(JSON.parse(calls[0].options.body).model, 'gemini-3.5-flash');
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

test('rejects private remote image URLs before making an outbound request', async () => {
  let fetchCalls = 0;

  await withGatewayEnvironment(async () => {
    fetchCalls += 1;
    throw new Error('fetch should not be called');
  }, async () => {
    const response = createResponse();
    await handler(createRemoteImageRequest('http://127.0.0.1/private.png'), response);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      error: 'Please use a public image URL.',
      code: 'INVALID_IMAGE_URL',
    });
  });

  assert.equal(fetchCalls, 0);
});

test('rejects remote responses that are not supported images', async () => {
  await withGatewayEnvironment(async () => new Response('<html>not an image</html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }), async () => {
    const response = createResponse();
    await handler(createRemoteImageRequest('https://93.184.216.34/not-image'), response);

    assert.equal(response.statusCode, 415);
    assert.deepEqual(response.body, {
      error: 'The URL must point to a JPG, PNG, or WebP image.',
      code: 'UNSUPPORTED_IMAGE_TYPE',
    });
  });
});

test('rejects oversized remote images before reading their body', async () => {
  await withGatewayEnvironment(async () => new Response('oversized', {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(10 * 1024 * 1024 + 1),
    },
  }), async () => {
    const response = createResponse();
    await handler(createRemoteImageRequest('https://93.184.216.34/huge.png'), response);

    assert.equal(response.statusCode, 413);
    assert.deepEqual(response.body, {
      error: 'Image too large (max 10 MB).',
      code: 'IMAGE_TOO_LARGE',
    });
  });
});

test('rejects unsupported inline data instead of forwarding it to an AI provider', async () => {
  let fetchCalls = 0;

  await withGatewayEnvironment(async () => {
    fetchCalls += 1;
    throw new Error('provider fetch should not be called');
  }, async () => {
    const response = createResponse();
    await handler(createRemoteImageRequest('data:text/html;base64,PGgxPm5vdCBhbiBpbWFnZTwvaDE+'), response);

    assert.equal(response.statusCode, 415);
    assert.deepEqual(response.body, {
      error: 'Please upload a JPG, PNG, or WebP image.',
      code: 'UNSUPPORTED_IMAGE_TYPE',
    });
  });

  assert.equal(fetchCalls, 0);
});

test('rejects unknown model formats before calling an AI provider', async () => {
  let fetchCalls = 0;

  await withGatewayEnvironment(async () => {
    fetchCalls += 1;
    throw new Error('provider fetch should not be called');
  }, async () => {
    const request = createRequest();
    request.body.format = 'unknown-model';
    const response = createResponse();
    await handler(request, response);

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      error: 'Please choose a supported prompt format and detail level.',
      code: 'INVALID_OPTIONS',
    });
  });

  assert.equal(fetchCalls, 0);
});

async function captureProviderPrompt(format) {
  let providerPrompt = '';
  const result = {
    mainPrompt: 'A faithful description of the visible scene.',
    modelPrompt: 'A model-ready prompt.',
    negativePrompt: 'unwanted artifacts',
    styleKeywords: ['faithful'],
    lighting: 'natural light',
    camera: 'eye level',
    colorPalette: 'neutral',
  };

  await withGatewayEnvironment(async (_url, options) => {
    const body = JSON.parse(options.body);
    providerPrompt = body.messages[0].content[1].text;
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(result) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }, async () => {
    const request = createRequest();
    request.body.format = format;
    const response = createResponse();
    await handler(request, response);
    assert.equal(response.statusCode, 200);
  });

  return providerPrompt;
}

test('anchors every generated prompt to visible evidence instead of invented details', async () => {
  const prompt = await captureProviderPrompt('general');
  assert.match(prompt, /visible evidence/i);
  assert.match(prompt, /do not guess[^\n]*(?:identity|brand|text)/i);
});

test('uses current Midjourney-specific prompt guidance', async () => {
  const prompt = await captureProviderPrompt('midjourney');
  assert.match(prompt, /--ar/);
  assert.match(prompt, /--no/);
  assert.match(prompt, /do not add[^\n]*--v/i);
});

test('uses edit-aware Nano Banana prompt guidance', async () => {
  const prompt = await captureProviderPrompt('nano-banana');
  assert.match(prompt, /preserve (?:the )?(?:subject's )?identity/i);
  assert.match(prompt, /what must not change/i);
  assert.match(prompt, /edit instruction/i);
});

test('uses motion-specific image-to-video prompt guidance', async () => {
  const prompt = await captureProviderPrompt('video');
  assert.match(prompt, /starting frame/i);
  assert.match(prompt, /end state/i);
  assert.match(prompt, /one (?:clear )?camera move/i);
  assert.match(prompt, /avoid (?:abrupt )?(?:cuts|scene changes)/i);
});
