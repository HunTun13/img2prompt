# Img2Prompt Site Growth Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Secure and clarify the existing generator, add trust pages, and publish three differentiated model landing pages that feed the homepage generator.

**Architecture:** Preserve the static homepage and Vercel function. Add strict backend remote-image validation, reusable static content-page styling, and model pages that deep-link into a query-parameter-aware homepage generator.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js CommonJS Vercel Serverless Function, Node built-in test runner, Vercel deployment.

## Global Constraints

- Keep the existing third-party AI provider first and Vercel AI Gateway fallback second.
- Do not add runtime dependencies or paid services.
- Do not add Google verification or GA4 identifiers until exact user-provided values exist.
- Do not hard-code an obsolete Midjourney version.
- Every public page uses `Img2Prompt`, an absolute canonical URL, and real user-facing content.
- Every behavior change follows red-green-refactor.

---

### Task 1: Accuracy, privacy, and remote-image safety

**Files:**
- Modify: `api/generate-prompt.js`
- Modify: `index.html`
- Modify: `test/generate-prompt.test.js`
- Modify: `test/seo-foundation.test.js`
- Modify: `functions/api/generate-prompt.js`

**Interfaces:**
- Consumes: request body `{ imageData, format, detail, cfToken }`.
- Produces: the same successful JSON shape and safe 4xx errors for invalid remote image URLs.

- [ ] Add failing source and handler tests asserting that Midjourney does not force `--v 6`, public branding contains no `PromptFromImage`, privacy wording discloses provider processing, localhost/private URLs are rejected, non-image responses are rejected, and oversized remote responses are rejected.
- [ ] Run `npm.cmd test` and confirm the new tests fail for the expected missing behavior.
- [ ] Implement URL parsing, public-host validation, redirect limits, timeout, image MIME validation, and streamed byte limits in `api/generate-prompt.js`.
- [ ] Update Midjourney guidance, brand copy, and privacy copy; mirror the function to `functions/api/generate-prompt.js`.
- [ ] Run `npm.cmd test` and confirm the full suite passes.
- [ ] Run `node --check api/generate-prompt.js` and `node --check functions/api/generate-prompt.js`.
- [ ] Commit with `fix: harden image processing and trust copy`.

### Task 2: Legal and contact pages

**Files:**
- Create: `assets/content-pages.css`
- Create: `privacy.html`
- Create: `terms.html`
- Create: `contact.html`
- Modify: `index.html`
- Modify: `test/seo-foundation.test.js`

**Interfaces:**
- Produces: `/privacy.html`, `/terms.html`, and `/contact.html`, linked from the homepage footer.

- [ ] Add failing tests for file existence, unique title/H1/canonical metadata, accurate provider disclosure, and homepage footer links.
- [ ] Run `npm.cmd test` and confirm the legal-page tests fail.
- [ ] Add the shared content-page stylesheet and the three complete pages.
- [ ] Add descriptive footer links from the homepage.
- [ ] Run `npm.cmd test` and confirm the full suite passes.
- [ ] Commit with `feat: add privacy terms and contact pages`.

### Task 3: Model landing pages and generator deep links

**Files:**
- Create: `midjourney-image-to-prompt.html`
- Create: `nano-banana-image-to-prompt.html`
- Create: `image-to-video-prompt.html`
- Modify: `index.html`
- Modify: `test/seo-foundation.test.js`

**Interfaces:**
- Consumes: homepage query parameter `format` in the allowlist `midjourney`, `nano-banana`, or `video`.
- Produces: preselected homepage generator format and three indexable content pages.

- [ ] Add failing tests for all three pages, unique metadata/H1/copy, three examples per page, cross-links, and model-specific CTA query parameters.
- [ ] Add a failing frontend test proving `/?format=midjourney#generator` preselects the Midjourney pill without allowing arbitrary values.
- [ ] Run `npm.cmd test` and confirm failures are caused by missing pages and deep-link behavior.
- [ ] Implement safe query-parameter preselection in the homepage script.
- [ ] Build three pages with distinct guidance, examples, tips, FAQs, and CTAs.
- [ ] Run `npm.cmd test` and confirm the full suite passes.
- [ ] Commit with `feat: add model-specific image prompt guides`.

### Task 4: Search integration

**Files:**
- Modify: `index.html`
- Modify: `sitemap.xml`
- Modify: `test/seo-foundation.test.js`

**Interfaces:**
- Produces: crawlable homepage links and sitemap entries for all public landing and trust pages.

- [ ] Add failing tests for descriptive homepage links and absolute sitemap URLs for all six new pages.
- [ ] Run `npm.cmd test` and confirm the sitemap/internal-link tests fail.
- [ ] Add a model-guide section to the homepage and update `sitemap.xml` with accurate `lastmod` values.
- [ ] Run `npm.cmd test` and confirm the full suite passes.
- [ ] Commit with `chore: connect model guides to search discovery`.

### Task 5: Full verification and production deployment

**Files:**
- Review: every tracked project file.

**Interfaces:**
- Produces: a reviewed pull request, merged `master`, successful Vercel deployment, and live production checks.

- [ ] Run `npm.cmd test` and record the exact pass count.
- [ ] Run both Node syntax checks and `git diff --check`.
- [ ] Serve the directory locally and smoke-test every public page plus homepage query-parameter links.
- [ ] Review the full diff for secrets, unsupported claims, broken links, duplicate metadata, and unrelated changes.
- [ ] Push `codex/site-growth-foundation`, create a pull request, and merge it after checks pass.
- [ ] Confirm the Vercel commit status is successful.
- [ ] Verify HTTPS status, homepage, all new pages, sitemap, robots.txt, and mobile rendering on `https://img2prompt.app`.
- [ ] Record the deployed milestone and the two remaining user-supplied configuration items: Google verification tag and GA4 measurement ID.

