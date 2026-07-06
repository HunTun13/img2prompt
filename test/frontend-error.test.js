const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const generateBlock = html.slice(
  html.indexOf('/* ===== GENERATE ===== */'),
  html.indexOf('/* ===== API PLACEHOLDER ===== */'),
);

test('shows API failures instead of silently substituting mock output', () => {
  assert.doesNotMatch(generateBlock, /getMockResult|Simulate latency|fallback to mock/i);
  assert.match(generateBlock, /catch \(err\)/);
  assert.match(generateBlock, /showToast/);
});

test('refreshes the single-use Turnstile token after every request', () => {
  assert.match(generateBlock, /turnstile\.reset/);
  assert.match(generateBlock, /state\.turnstileToken\s*=\s*null/);
});

test('keeps the main inline script syntactically valid', () => {
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new vm.Script(script));
});
