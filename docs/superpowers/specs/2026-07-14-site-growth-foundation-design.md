# Img2Prompt Site Growth Foundation Design

## Goal

Prepare Img2Prompt for sustainable organic growth by fixing trust and security gaps, proving model-specific value, and publishing three distinct search landing pages without adding paid infrastructure.

## Locked scope

- Keep the existing static HTML plus Vercel Serverless architecture.
- Keep the third-party-first AI route and Vercel AI Gateway fallback.
- Do not promise unlimited generations.
- Do not publish fake reviews, mass-generated pages, or duplicated model pages.
- Publish the first three landing pages for Midjourney, Nano Banana, and image-to-video.
- Defer Flux, Stable Diffusion, DALL·E, blog, and localization pages until search data exists.
- Defer Google verification and GA4 script insertion until the user supplies the exact verification tag and `G-...` measurement ID.

## Architecture

The homepage remains the only generator interface. Model landing pages provide genuinely distinct guidance and examples, then link to `/?format=<model>#generator`; the homepage reads the query parameter and preselects the requested output format. This avoids duplicating the generator implementation across static pages.

Shared styles for content pages live in `assets/content-pages.css`. Privacy, terms, and contact pages use the same shell. Each public page has its own title, description, canonical URL, visible H1, and contextual links.

The server validates remote image URLs before downloading them. Only public HTTP(S) image URLs are allowed; localhost, private/reserved IP ranges, credentials in URLs, non-image responses, oversized responses, excessive redirects, and slow downloads are rejected with safe client messages.

## Content design

Each model landing page includes:

- A model-specific promise and CTA.
- A concise explanation of how that model interprets prompts.
- Three model-specific prompt examples covering portrait, product, and environment scenes.
- Practical tips that differ by model.
- Visible FAQ content and links to the generator and other relevant pages.

Midjourney content follows the current default model behavior and does not hard-code an obsolete version flag. Nano Banana content emphasizes descriptive natural language and editing consistency. Image-to-video content emphasizes camera motion, subject motion, environmental change, and timing.

## Trust design

Homepage privacy copy states that Img2Prompt does not intentionally retain uploads, while images are sent to configured AI providers for processing and provider handling is governed by their services. Privacy and terms pages explain processing, cookies/analytics status, acceptable use, service availability, and contact details without making unsupported guarantees.

Brand references are consistently `Img2Prompt` in visible copy and structured data.

## Testing

All behavior changes use test-first development:

- Backend tests cover safe URL validation and download limits.
- Source tests cover current Midjourney guidance, brand consistency, privacy wording, legal pages, canonical metadata, model page uniqueness, homepage deep links, and sitemap entries.
- Existing provider fallback and frontend error tests remain green.
- Final verification includes the full Node test suite, syntax checks, whitespace checks, local HTTP smoke tests, and production URL checks after deployment.

## Deployment

Work is committed on `codex/site-growth-foundation`, pushed, reviewed through a pull request, squash-merged to `master`, and deployed automatically by Vercel. Production verification covers HTTPS, homepage, API error safety, all new pages, sitemap, robots.txt, mobile rendering, and navigation.

## Success criteria

- No obsolete Midjourney `--v 6` output instruction remains.
- No `PromptFromImage` brand reference remains in public content.
- Remote image fetching rejects SSRF-style and oversized inputs.
- Privacy statements accurately disclose third-party processing.
- Three model pages are accessible, indexable, internally linked, and listed in the sitemap.
- All automated checks pass and the Vercel deployment reports success.
