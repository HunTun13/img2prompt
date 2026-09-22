const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const pages = [
  {
    directory: 'midjourney-image-to-prompt',
    title: 'Midjourney Image to Prompt - Convert Image to MJ Prompt | Img2Prompt',
    h1: 'Midjourney Image to Prompt',
    canonical: 'https://img2prompt.app/midjourney-image-to-prompt/',
    format: 'midjourney',
  },
  {
    directory: 'nano-banana-image-to-prompt',
    title: 'Nano Banana Image to Prompt - Free AI Tool | Img2Prompt',
    h1: 'Nano Banana Image to Prompt',
    canonical: 'https://img2prompt.app/nano-banana-image-to-prompt/',
    format: 'nano-banana',
  },
  {
    directory: 'image-to-video-prompt',
    title: 'Image to Video Prompt Generator - AI Video Prompt Tool | Img2Prompt',
    h1: 'Image to Video Prompt Generator',
    canonical: 'https://img2prompt.app/image-to-video-prompt/',
    format: 'video',
  },
  {
    directory: 'stable-diffusion-image-to-prompt',
    title: 'Stable Diffusion Image to Prompt - SD Prompt Generator | Img2Prompt',
    h1: 'Stable Diffusion Image to Prompt',
    canonical: 'https://img2prompt.app/stable-diffusion-image-to-prompt/',
    format: 'stable-diffusion',
  },
  {
    directory: 'character-consistency-prompt',
    title: 'Character Consistency Prompt Generator - AI Character Tool | Img2Prompt',
    h1: 'Character Consistency Prompt Generator',
    canonical: 'https://img2prompt.app/character-consistency-prompt/',
    format: 'nano-banana',
  },
];

const newPages = [
  { directory: 'image-to-prompt-generator', title: 'Image to Prompt Generator - Free Online AI Tool | Img2Prompt', h1: 'Image to Prompt Generator', useCase: 'general', format: 'general', related: 'midjourney-image-to-prompt' },
  { directory: 'product-image-to-prompt', title: 'Product Image to Prompt - E-commerce Scene Briefs | Img2Prompt', h1: 'Product Image to Prompt', useCase: 'product', format: 'general', related: 'stable-diffusion-image-to-prompt' },
  { directory: 'anime-image-to-prompt', title: 'Anime Image to Prompt - Character and Style Guide | Img2Prompt', h1: 'Anime Image to Prompt', useCase: 'anime', format: 'general', related: 'character-consistency-prompt' },
  { directory: 'interior-design-prompt', title: 'Interior Design Prompts - Room Styles from References | Img2Prompt', h1: 'Interior Design Prompts', useCase: 'interior', format: 'general', related: 'nano-banana-image-to-prompt' },
];

function readPage(directory) {
  const pagePath = path.join(root, directory, 'index.html');
  assert.equal(fs.existsSync(pagePath), true, `${directory} should have an index page`);
  return fs.readFileSync(pagePath, 'utf8');
}

test('publishes five distinct model and workflow pages with complete metadata', () => {
  for (const page of pages) {
    const html = readPage(page.directory);
    assert.match(html, new RegExp(`<title>${page.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</title>`));
    assert.match(html, new RegExp(`<h1[^>]*>${page.h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`));
    assert.match(html, new RegExp(`<link rel="canonical" href="${page.canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(html, /<meta name="description" content="[^\"]{100,160}">/);
    assert.match(html, /"@type"\s*:\s*"FAQPage"/);
    assert.match(html, new RegExp(`data-prompt-tool data-use-case="general" data-default-format="${page.format}"`));
    assert.match(html, /"@type"\s*:\s*"SoftwareApplication"/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
  }
});

test('publishes four distinct generator and scene pages with working tool metadata', () => {
  for (const page of newPages) {
    const html = readPage(page.directory);
    assert.match(html, new RegExp(`<title>${page.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</title>`));
    assert.match(html, new RegExp(`<h1[^>]*>${page.h1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`));
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://img2prompt\\.app/${page.directory}/"`));
    assert.match(html, /<meta name="description" content="[^\"]{100,160}">/);
    assert.match(html, new RegExp(`data-prompt-tool data-use-case="${page.useCase}" data-default-format="${page.format}"`));
    assert.match(html, /assets\/embedded-generator\.js/);
    assert.match(html, /"@type"\s*:\s*"SoftwareApplication"/);
    assert.match(html, /href="\/"/, `${page.directory} should link to the homepage`);
    assert.match(html, new RegExp(`href="/${page.related}/"`), `${page.directory} should link to a related guide`);
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

test('Stable Diffusion page separates positive and negative prompts and explains local workflow limits', () => {
  const html = readPage('stable-diffusion-image-to-prompt');
  assert.match(html, /positive prompt/i);
  assert.match(html, /negative prompt/i);
  assert.match(html, /checkpoint/i);
  assert.match(html, /LoRA/i);
  assert.match(html, /A1111/i);
  assert.match(html, /ComfyUI/i);
  assert.doesNotMatch(html, /guarantee|exact original prompt/i);
});

test('Character consistency page separates fixed identity anchors from scene changes', () => {
  const html = readPage('character-consistency-prompt');
  assert.match(html, /tool below analyzes your image in Nano Banana format/i);
  assert.match(html, /identity anchor/i);
  assert.match(html, /what stays fixed/i);
  assert.match(html, /what changes/i);
  assert.match(html, /reference image/i);
  assert.match(html, /cannot guarantee/i);
});

test('scene pages offer distinct material beyond the common uploader', () => {
  assert.match(readPage('product-image-to-prompt'), /Editable ad copy brief/);
  assert.match(readPage('anime-image-to-prompt'), /character design sheet/);
  assert.match(readPage('interior-design-prompt'), /Style comparison for the same room/);
  assert.match(readPage('image-to-prompt-generator'), /What goes in, and what comes out/);
});

test('landing pages provide contextual links to the other model guides', () => {
  for (const page of pages) {
    const html = readPage(page.directory);
    for (const target of pages.filter(target => target.directory !== page.directory)) {
      assert.match(html, new RegExp(`href="/${target.directory}/"`));
    }
  }
});

test('homepage links to the generator, scene pages, and model guides', () => {
  assert.match(homepage, /href="\/image-to-prompt-generator\/"/);
  assert.match(homepage, /href="\/product-image-to-prompt\/"/);
  assert.match(homepage, /href="\/anime-image-to-prompt\/"/);
  assert.match(homepage, /href="\/interior-design-prompt\/"/);
  assert.match(homepage, /href="\/midjourney-image-to-prompt\/"/);
  assert.match(homepage, /href="\/nano-banana-image-to-prompt\/"/);
  assert.match(homepage, /href="\/image-to-video-prompt\/"/);
  assert.match(homepage, /href="\/stable-diffusion-image-to-prompt\/"/);
  assert.match(homepage, /href="\/character-consistency-prompt\/"/);
  assert.doesNotMatch(homepage, /Includes[^<]*[–—-]{1,2}v(?:\s|,|<)/i);
});

test('homepage compares model-specific prompts for the same reference image', () => {
  const comparison = homepage.slice(
    homepage.indexOf('id="model-comparison"'),
    homepage.indexOf('<!-- HOW TO USE -->'),
  );

  assert.match(comparison, /Same image, different model/i);
  assert.equal((comparison.match(/class="model-prompt-card"/g) || []).length, 3);
  assert.match(comparison, /href="\/\?format=midjourney#generator"/);
  assert.match(comparison, /href="\/\?format=flux#generator"/);
  assert.match(comparison, /href="\/\?format=stable-diffusion#generator"/);
  assert.match(comparison, /--ar 4:3 --raw/);
  assert.match(comparison, /Negative prompt:/i);
});

test('sitemap exposes all public landing and trust pages with absolute URLs', () => {
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const publicPaths = [
    '/',
    '/image-to-prompt-generator/',
    '/midjourney-image-to-prompt/',
    '/nano-banana-image-to-prompt/',
    '/image-to-video-prompt/',
    '/stable-diffusion-image-to-prompt/',
    '/character-consistency-prompt/',
    '/product-image-to-prompt/',
    '/anime-image-to-prompt/',
    '/interior-design-prompt/',
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
    'image-to-prompt-generator/index.html',
    'midjourney-image-to-prompt/index.html',
    'nano-banana-image-to-prompt/index.html',
    'image-to-video-prompt/index.html',
    'stable-diffusion-image-to-prompt/index.html',
    'character-consistency-prompt/index.html',
    'product-image-to-prompt/index.html',
    'anime-image-to-prompt/index.html',
    'interior-design-prompt/index.html',
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

  assert.equal(blockCount, 17);
});
