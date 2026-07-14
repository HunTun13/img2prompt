const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('publishes a root sitemap with canonical production URLs', () => {
  const sitemapPath = path.join(root, 'sitemap.xml');
  assert.equal(fs.existsSync(sitemapPath), true, 'sitemap.xml should exist at the site root');

  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemap, /<loc>https:\/\/img2prompt\.app\/<\/loc>/);
  assert.doesNotMatch(sitemap, /<loc>\//, 'sitemap URLs should be absolute');
});

test('robots.txt allows search crawling and points crawlers to the sitemap', () => {
  const robotsPath = path.join(root, 'robots.txt');
  assert.equal(fs.existsSync(robotsPath), true, 'robots.txt should exist at the site root');

  const robots = fs.readFileSync(robotsPath, 'utf8');
  assert.match(robots, /User-agent:\s*\*/);
  assert.match(robots, /Allow:\s*\//);
  assert.match(robots, /Sitemap:\s*https:\/\/img2prompt\.app\/sitemap\.xml/);
  assert.doesNotMatch(robots, /User-agent:\s*Googlebot[\s\S]*?Disallow:\s*\//i);
  assert.match(robots, /User-agent:\s*GPTBot[\s\S]*?Disallow:\s*\//i);
});

test('front-end exposes safe analytics event hooks for the conversion funnel', () => {
  assert.match(html, /function trackEvent\(/);
  assert.match(html, /window\.gtag/);

  [
    'image_upload',
    'image_url_load',
    'prompt_generate_start',
    'prompt_generate_success',
    'prompt_generate_error',
    'prompt_copy',
    'prompt_download',
  ].forEach(eventName => {
    assert.match(html, new RegExp(`trackEvent\\('${eventName}'`), `${eventName} should be tracked`);
  });
});

test('uses current model guidance and consistent public branding', () => {
  const apiSource = fs.readFileSync(path.join(root, 'api', 'generate-prompt.js'), 'utf8');

  assert.doesNotMatch(apiSource, /--v 6\b/, 'Midjourney output must not force an obsolete version');
  assert.doesNotMatch(html, /PromptFromImage/, 'public copy and structured data should use Img2Prompt');
});

test('accurately discloses third-party image processing', () => {
  assert.match(
    html,
    /sent to (?:our )?configured AI (?:service providers|providers) for processing/i,
    'privacy copy should disclose AI provider processing',
  );
  assert.doesNotMatch(
    html,
    /not stored or retained on our servers after processing/i,
    'privacy copy must not make an unsupported absolute retention promise',
  );
});

test('publishes complete trust pages with unique canonical metadata', () => {
  const pages = [
    { directory: 'privacy', title: /Privacy Policy \| Img2Prompt/, h1: /Privacy Policy/, canonical: 'https://img2prompt.app/privacy/' },
    { directory: 'terms', title: /Terms of Use \| Img2Prompt/, h1: /Terms of Use/, canonical: 'https://img2prompt.app/terms/' },
    { directory: 'contact', title: /Contact \| Img2Prompt/, h1: /Contact Img2Prompt/, canonical: 'https://img2prompt.app/contact/' },
  ];

  assert.equal(fs.existsSync(path.join(root, 'assets', 'content-pages.css')), true);

  for (const page of pages) {
    const pagePath = path.join(root, page.directory, 'index.html');
    assert.equal(fs.existsSync(pagePath), true, `${page.directory} page should exist`);
    const pageHtml = fs.readFileSync(pagePath, 'utf8');
    assert.match(pageHtml, page.title);
    assert.match(pageHtml, new RegExp(`<h1[^>]*>${page.h1.source}</h1>`));
    assert.match(pageHtml, new RegExp(`<link rel="canonical" href="${page.canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(pageHtml, /assets\/content-pages\.css/);
  }

  const privacyHtml = fs.readFileSync(path.join(root, 'privacy', 'index.html'), 'utf8');
  assert.match(privacyHtml, /configured AI service providers/i);
  assert.match(privacyHtml, /does not sell/i);
  assert.match(privacyHtml, /Cloudflare Turnstile/i);
});

test('links trust pages from the homepage footer', () => {
  assert.match(html, /href="\/privacy\/"[^>]*>Privacy</);
  assert.match(html, /href="\/terms\/"[^>]*>Terms</);
  assert.match(html, /href="\/contact\/"[^>]*>Contact</);
});

test('does not publish unverifiable ratings or review counts', () => {
  assert.doesNotMatch(html, /aggregateRating|reviewCount|ratingValue/);
});
