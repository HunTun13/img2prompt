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
