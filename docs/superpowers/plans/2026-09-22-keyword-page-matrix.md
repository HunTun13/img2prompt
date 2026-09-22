# Keyword Page Matrix Implementation Plan

> **For agentic workers:** Use the existing HTML site patterns and verify each batch before publishing. This plan implements the owner's 2026-09-22 page brief in this task.

**Goal:** Publish a distinct page for the generator query, improve five existing guides, add three task-specific scene pages, and expose every canonical URL in the sitemap.

**Architecture:** Keep the existing home uploader. A small shared embedded generator powers the four new landing pages and calls the existing same-origin API. The API accepts only a fixed set of optional use cases, keeping the current general flow intact. Existing model guides retain their evidence/examples and gain focused modules.

**Tech Stack:** Static HTML/CSS/JS, Vercel serverless function, Cloudflare fallback function, Node test runner.

**Spec:** User's 2026-09-22 Chinese page matrix brief in the current task.

## Global Constraints

- Canonical URL and exactly one H1 per landing page.
- Target query first in each title, with distinct main content and natural internal links.
- No invented original-prompt recovery, ratings, quota claims, or generated images.
- The product page may show an editable ad-copy formula; the API's primary output remains image-generation prompts.
- Update `lastmod` only for pages significantly edited in this release.
- Preserve pre-existing untracked files and unrelated changes.

---

### Task 1: Home query focus and navigation

**Files:** `index.html`, `test/seo-foundation.test.js`

- [ ] Set the user-specified home title, description and visible two-sentence concept explanation immediately above the uploader.
- [ ] Add contextual links to the dedicated generator page and scene pages without removing the existing model comparison, gallery or FAQ.
- [ ] Run `npm test` and inspect title, H1, canonical, FAQ JSON-LD and upload controls.

### Task 2: Shared generator and dedicated generator page

**Files:** `assets/embedded-generator.js`, `assets/embedded-generator.css`, `image-to-prompt-generator/index.html`, `api/generate-prompt.js`, `functions/api/generate-prompt.js`, `test/generate-prompt.test.js`

- [ ] Build a compact file/URL uploader for JPG, PNG and WEBP, model and detail selectors, Turnstile, API errors, result and copy controls.
- [ ] Keep the API backward compatible while accepting only `general`, `product`, `anime`, or `interior` as optional use cases.
- [ ] Create the dedicated page with a dated, cited competitor comparison, a concrete result-field guide and its own FAQ.
- [ ] Add tests for use-case whitelisting and run `npm test`; verify the upload flow in a browser.

### Task 3: Existing model and workflow guides

**Files:** five existing `*/index.html` guide pages, `test/model-pages.test.js`

- [ ] Update titles, H1s, descriptions and introductions to the supplied target queries.
- [ ] Add distinct requested modules: MJ syntax, SD positive/negative and workflow, Nano Banana editing, video motion planning, character anchors.
- [ ] Preserve practical prompt examples and existing canonical URLs; check natural links to home and related pages.
- [ ] Update content assertions and run `npm test`.

### Task 4: Three distinct scene pages

**Files:** `product-image-to-prompt/index.html`, `anime-image-to-prompt/index.html`, `interior-design-prompt/index.html`, `test/model-pages.test.js`

- [ ] Use the shared embedded generator with a scene-specific use case on each page.
- [ ] Write product, anime, and interior examples, guidance and FAQs with distinct vocabulary and section structures.
- [ ] Show product ad-copy as a user-editable template, not a claimed generated field.
- [ ] Verify metadata, links, structured data and the shared tool on all three pages.

### Task 5: Discovery and release

**Files:** `sitemap.xml`, `index.html`, `README.md`, relevant tests

- [ ] Add four new canonical URLs and update significant-content `lastmod` values to the release date.
- [ ] Run `npm test`, inspect all JSON-LD and internal links, and smoke-test the built site.
- [ ] Commit only this task's files and deploy through the repo's established GitHub flow if available.
- [ ] Once live, confirm 200/canonical/sitemap and submit the sitemap once in GSC if the signed-in property is accessible.
