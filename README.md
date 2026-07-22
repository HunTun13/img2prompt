# Img2Prompt

Img2Prompt is a free image-to-prompt generator that turns reference images into model-ready prompts for creative AI workflows.

Live site: [img2prompt.app](https://img2prompt.app/)

## What it does

- Upload an image or paste a public image URL
- Generate structured prompts from visible image details
- Choose prompt formats for Midjourney, Flux, Stable Diffusion, Nano Banana, DALL-E, image-to-video, or JSON
- Copy or download the generated prompt
- Use the tool without creating an account

## Prompt guides

- [Midjourney Image to Prompt Generator](https://img2prompt.app/midjourney-image-to-prompt/)
- [Nano Banana Image to Prompt Generator](https://img2prompt.app/nano-banana-image-to-prompt/)
- [Image to Video Prompt Generator](https://img2prompt.app/image-to-video-prompt/)

## Project notes

The public site is built as a lightweight HTML application with a serverless prompt-generation API. Images are processed for the current request and sent to configured AI service providers; see the [privacy policy](https://img2prompt.app/privacy/) for details.

## Development

```bash
npm test
```

