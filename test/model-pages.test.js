const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const pages = [
  {
    directory: 'midjourney-image-to-prompt',
    title: 'Midjourney Image to Prompt Generator | Img2Prompt',
    h1: 'Midjourney Image to Prompt Generator',
    canonical: 'https://img2prompt.app/midjourney-image-to-prompt/',
    format: 'midjourney',
  },
  {
    directory: 'nano-banana-image-to-prompt',
    title: 'Nano Banana Image to Prompt Generator | Img2Prompt',
    h1: 'Nano Banana Image to Prompt Generator',
    canonical: 'https://img2prompt.app/nano-banana-image-to-prompt/',
    format: 'nano-banana',
  },
  {
    directory: 'image-to-video-prompt',
    title: 'Image to Video Prompt Generator | Img2Prompt',
    h1: 'Image to Video Prompt Generator',
    canonical: 'https://img2prompt.app/image-to-video-prompt/',
    format: 'video',
  },
];

function readPage(directory) {
  const pagePath = path.join(root, directory, 'index.html');
  assert.equal(fs.existsSync(pagePath), true, `${directory} should have an index page`);
  return fs.readFileSync(pagePath, 'utf8');
}

test('publishes three distinct model landing pages with complete metadata', () => {
  for (const page of pages) {
    const html = readPage(page.directory);
    assert.match(html, new RegExp(`<title>${page.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</title>`));
    assert.match(html, new RegExp(`<h1[^>]*>${page.h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`));
    assert.match(html, new RegExp(`<link rel="canonical" href="${page.canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(html, /<meta name="description" content="[^\"]{80,170}">/);
    assert.match(html, /"@type"\s*:\s*"FAQPage"/);
  }
});

test('each model page contains at least three concrete prompt examples', () => {
  for (const page of pages) {
    const html = readPage(page.directory);
    assert.ok((html.match(/class="example-card"/g) || []).length >= 3, `${page.directory} needs three examples`);
    assert.ok((html.match(/class="prompt-output"/g) || []).length >= 3, `${page.directory} needs three prompt outputs`);
  }
});

test('model pages link directly to the generator with a safe format selection', () => {
  for (const page of pages) {
    const html = readPage(page.directory);
    assert.match(html, new RegExp(`href="/\\?format=${page.format}#generator"`));
  }

  assert.match(homepage, /new URLSearchParams\(window\.location\.search\)\.get\('format'\)/);
  assert.match(homepage, /PUBLIC_FORMATS\s*=\s*new Set/);
  assert.match(homepage, /PUBLIC_FORMATS\.has\(requestedFormat\)/);
  assert.match(homepage, /pill\.dataset\.val === state\.format/);
});

test('Midjourney page teaches useful parameters without pinning an obsolete version', () => {
  const html = readPage('midjourney-image-to-prompt');
  assert.match(html, /--ar/);
  assert.match(html, /--raw/);
  assert.match(html, /--no/);
  assert.doesNotMatch(html, /--v\s+\d/);
});

test('Nano Banana page focuses on explicit edits and subject consistency', () => {
  const html = readPage('nano-banana-image-to-prompt');
  assert.match(html, /preserve[^<]{0,80}identity/i);
  assert.match(html, /what must not change/i);
  assert.match(html, /edit instruction/i);
});

test('image-to-video page separates camera, subject, and ending motion', () => {
  const html = readPage('image-to-video-prompt');
  assert.match(html, /camera movement/i);
  assert.match(html, /subject motion/i);
  assert.match(html, /end state/i);
  assert.match(html, /negative motion/i);
});

test('landing pages provide contextual links to the other model guides', () => {
  for (const page of pages) {
    const html = readPage(page.directory);
    for (const target of pages.filter(target => target.directory !== page.directory)) {
      assert.match(html, new RegExp(`href="/${target.directory}/"`));
    }
  }
});

test('homepage links its model cards to the three in-depth guides', () => {
  assert.match(homepage, /href="\/midjourney-image-to-prompt\/"/);
  assert.match(homepage, /href="\/nano-banana-image-to-prompt\/"/);
  assert.match(homepage, /href="\/image-to-video-prompt\/"/);
  assert.doesNotMatch(homepage, /Includes[^<]*[–—-]{1,2}v(?:\s|,|<)/i);
});

test('sitemap exposes all public landing and trust pages with absolute URLs', () => {
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const publicPaths = [
    '/',
    '/midjourney-image-to-prompt/',
    '/nano-banana-image-to-prompt/',
    '/image-to-video-prompt/',
    '/privacy/',
    '/terms/',
    '/contact/',
  ];

  for (const publicPath of publicPaths) {
    assert.match(sitemap, new RegExp(`<loc>https://img2prompt\\.app${publicPath.replace(/\//g, '\\/')}</loc>`));
  }
  assert.equal((sitemap.match(/<url>/g) || []).length, publicPaths.length);
});

test('all published JSON-LD blocks contain valid JSON', () => {
  const structuredPages = [
    'index.html',
    'midjourney-image-to-prompt/index.html',
    'nano-banana-image-to-prompt/index.html',
    'image-to-video-prompt/index.html',
  ];
  let blockCount = 0;

  for (const page of structuredPages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.ok(blocks.length > 0, `${page} should contain structured data`);
    for (const block of blocks) {
      assert.doesNotThrow(() => JSON.parse(block[1]), `${page} contains invalid JSON-LD`);
      blockCount += 1;
    }
  }

  assert.equal(blockCount, 6);
});
