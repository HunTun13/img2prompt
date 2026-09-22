(() => {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const allowedUseCases = new Set(['general', 'product', 'anime', 'interior']);
  const formats = [
    ['general', 'General'], ['midjourney', 'Midjourney'], ['flux', 'Flux'],
    ['stable-diffusion', 'Stable Diffusion'], ['nano-banana', 'Nano Banana'],
    ['dalle', 'DALL·E'], ['video', 'Image to Video'], ['json', 'JSON']
  ];

  document.querySelectorAll('[data-prompt-tool]').forEach((root, index) => {
    const useCase = allowedUseCases.has(root.dataset.useCase) ? root.dataset.useCase : 'general';
    const defaultFormat = formats.some(([value]) => value === root.dataset.defaultFormat)
      ? root.dataset.defaultFormat : 'general';
    const fileId = `prompt-file-${index}`;
    root.innerHTML = `
      <div class="prompt-tool" role="region" aria-label="Image to prompt tool">
        <div class="prompt-tool-heading"><strong>Try it with your image</strong><span>JPG, PNG or WebP · 10 MB max</span></div>
        <label class="prompt-tool-upload" for="${fileId}">Choose an image <small>or drag and drop it here</small></label>
        <input class="prompt-tool-file" id="${fileId}" type="file" accept="image/jpeg,image/png,image/webp">
        <div class="prompt-tool-url-row"><label for="prompt-url-${index}">Or paste a public image URL</label><input id="prompt-url-${index}" class="prompt-tool-url" type="url" placeholder="https://example.com/image.webp"></div>
        <div class="prompt-tool-preview" hidden><img alt="Selected image preview"><button type="button" class="prompt-tool-clear">Remove image</button></div>
        <div class="prompt-tool-options"><label>Prompt format<select class="prompt-tool-format">${formats.map(([value, label]) => `<option value="${value}"${value === defaultFormat ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label>Detail level<select class="prompt-tool-detail"><option value="short">Short</option><option value="balanced">Balanced</option><option value="detailed" selected>Detailed</option></select></label></div>
        <div class="prompt-tool-verification"><div class="cf-turnstile" data-sitekey="0x4AAAAAADv7oycxS1WRd0hY" data-callback="onEmbeddedTurnstileVerified" data-expired-callback="onEmbeddedTurnstileExpired" data-theme="light"></div></div>
        <button type="button" class="prompt-tool-submit" disabled>Generate prompt</button>
        <p class="prompt-tool-status" role="status" aria-live="polite">Choose an image and complete verification to begin.</p>
        <div class="prompt-tool-result" hidden><h2>Your prompt</h2><div class="prompt-tool-fields"></div><button type="button" class="prompt-tool-copy">Copy main prompt</button></div>
        <p class="prompt-tool-privacy">Your image is sent to our configured AI provider for this request. Img2Prompt does not intentionally retain it afterward.</p>
      </div>`;

    const file = root.querySelector('.prompt-tool-file');
    const url = root.querySelector('.prompt-tool-url');
    const upload = root.querySelector('.prompt-tool-upload');
    const preview = root.querySelector('.prompt-tool-preview');
    const previewImage = preview.querySelector('img');
    const submit = root.querySelector('.prompt-tool-submit');
    const status = root.querySelector('.prompt-tool-status');
    const result = root.querySelector('.prompt-tool-result');
    let imageData = '';
    let token = '';
    let lastResult = null;

    function updateButton() { submit.disabled = !imageData || !token; }
    function setStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle('is-error', isError);
    }
    function setImage(source) {
      imageData = source;
      previewImage.src = source;
      preview.hidden = false;
      result.hidden = true;
      setStatus(token ? 'Ready to generate.' : 'Complete verification to generate.');
      updateButton();
    }
    function clearImage() {
      imageData = '';
      file.value = '';
      url.value = '';
      previewImage.removeAttribute('src');
      preview.hidden = true;
      result.hidden = true;
      setStatus('Choose an image and complete verification to begin.');
      updateButton();
    }
    function useFile(selected) {
      if (!selected) return;
      if (!allowedTypes.has(selected.type)) return setStatus('Choose a JPG, PNG or WebP image.', true);
      if (selected.size > 10 * 1024 * 1024) return setStatus('Image must be 10 MB or smaller.', true);
      url.value = '';
      const reader = new FileReader();
      reader.onerror = () => setStatus('Could not read the image. Please try another file.', true);
      reader.onload = () => setImage(reader.result);
      reader.readAsDataURL(selected);
    }

    file.addEventListener('change', () => useFile(file.files[0]));
    upload.addEventListener('dragover', event => { event.preventDefault(); upload.classList.add('is-dragging'); });
    upload.addEventListener('dragleave', () => upload.classList.remove('is-dragging'));
    upload.addEventListener('drop', event => {
      event.preventDefault();
      upload.classList.remove('is-dragging');
      useFile(event.dataTransfer.files[0]);
    });
    url.addEventListener('change', () => {
      const value = url.value.trim();
      if (!value) return clearImage();
      try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
        file.value = '';
        setImage(parsed.href);
      } catch { setStatus('Enter a public http or https image URL.', true); }
    });
    preview.querySelector('.prompt-tool-clear').addEventListener('click', clearImage);

    window.onEmbeddedTurnstileVerified = value => {
      token = value;
      if (imageData) setStatus('Ready to generate.');
      updateButton();
    };
    window.onEmbeddedTurnstileExpired = () => {
      token = '';
      setStatus('Verification expired. Please verify again.', true);
      updateButton();
    };

    submit.addEventListener('click', async () => {
      if (!imageData || !token) return;
      submit.disabled = true;
      submit.textContent = 'Generating…';
      setStatus('Analyzing your image…');
      result.hidden = true;
      try {
        const response = await fetch('/api/generate-prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageData, format: root.querySelector('.prompt-tool-format').value,
            detail: root.querySelector('.prompt-tool-detail').value,
            useCase, cfToken: token
          })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
        if (!data.mainPrompt) throw new Error('The response did not contain a prompt. Please retry.');
        lastResult = data;
        const fields = root.querySelector('.prompt-tool-fields');
        fields.replaceChildren();
        [
          ['Main prompt', 'mainPrompt'], ['Model prompt', 'modelPrompt'],
          ['Negative prompt', 'negativePrompt'], ['Style keywords', 'styleKeywords'],
          ['Lighting', 'lighting'], ['Camera / composition', 'camera'], ['Color palette', 'colorPalette']
        ].forEach(([label, key]) => {
          if (!data[key]) return;
          const section = document.createElement('section');
          const heading = document.createElement('h3');
          const body = document.createElement('p');
          heading.textContent = label;
          body.textContent = Array.isArray(data[key]) ? data[key].join(', ') : String(data[key]);
          section.append(heading, body);
          fields.append(section);
        });
        result.hidden = false;
        setStatus('Prompt ready. Review and refine it for your target model.');
        result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (error) {
        setStatus(`Generation failed: ${error.message}`, true);
      } finally {
        token = '';
        if (window.turnstile) window.turnstile.reset();
        submit.textContent = 'Generate prompt';
        updateButton();
      }
    });

    root.querySelector('.prompt-tool-copy').addEventListener('click', async () => {
      if (!lastResult?.mainPrompt) return;
      try {
        await navigator.clipboard.writeText(lastResult.mainPrompt);
        setStatus('Main prompt copied.');
      } catch { setStatus('Could not copy automatically. Select the prompt text above.', true); }
    });
  });
})();
