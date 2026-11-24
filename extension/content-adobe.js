// Content Script for Adobe Stock Contributor Portal (https://contributor.stock.adobe.com/*)
// Handles file dropzone injection & semi-automatic metadata/AI-disclosure filling.

(() => {
  if (window.__adobeHelperContentLoaded) return;
  window.__adobeHelperContentLoaded = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function deepQueryAll(selector, root = document) {
    const results = [];
    const seen = new Set();
    const walk = node => {
      if (!node || typeof node.querySelectorAll !== 'function') return;
      for (const el of node.querySelectorAll(selector)) {
        if (!seen.has(el)) {
          seen.add(el);
          results.push(el);
        }
      }
      for (const el of node.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(root);
    return results;
  }

  function setNativeValue(el, value) {
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
    return true;
  }

  function getLabelText(el) {
    const parts = [];
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    if (el.getAttribute('placeholder')) parts.push(el.getAttribute('placeholder'));
    if (el.getAttribute('name')) parts.push(el.getAttribute('name'));
    if (el.getAttribute('data-testid')) parts.push(el.getAttribute('data-testid'));
    if (el.id) {
      parts.push(el.id);
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) parts.push(lbl.textContent);
    }
    const parentLabel = el.closest('label');
    if (parentLabel) parts.push(parentLabel.textContent);
    const parentField = el.closest('[class*="field" i], [class*="form" i], [class*="row" i], [class*="container" i]');
    if (parentField) {
      const heading = parentField.querySelector('label, [class*="label" i], legend, span');
      if (heading) parts.push(heading.textContent);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findFileInput() {
    const inputs = deepQueryAll('input[type="file"]');
    return inputs.find(inp => inp.multiple) || inputs[0] || null;
  }

  function base64ToUint8(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  async function injectFiles(filesPayload = []) {
    if (!Array.isArray(filesPayload) || filesPayload.length === 0) {
      return { ok: false, error: 'Tidak ada file yang dikirim.' };
    }

    const files = filesPayload.map(f => {
      const bytes = base64ToUint8(f.base64);
      return new File([bytes], f.name, { type: f.mimeType || 'application/octet-stream' });
    });

    const dt = new DataTransfer();
    for (const file of files) dt.items.add(file);

    const input = findFileInput();
    if (input) {
      try {
        input.files = dt.files;
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return { ok: true, count: files.length, method: 'file-input' };
      } catch (err) {
        console.warn('File input assign fallback to drop:', err);
      }
    }

    const dropTargets = deepQueryAll('[data-testid*="drop" i], [class*="dropzone" i], [class*="upload" i]')
      .filter(isVisible);
    const target = dropTargets[0];
    if (target) {
      for (const evtName of ['dragenter', 'dragover', 'drop']) {
        const evt = new DragEvent(evtName, {
          bubbles: true,
          cancelable: true,
          composed: true,
          dataTransfer: dt
        });
        target.dispatchEvent(evt);
      }
      return { ok: true, count: files.length, method: 'dropzone' };
    }

    return {
      ok: false,
      error: 'Dropzone upload Adobe Stock tidak ditemukan. Buka halaman Upload Files di contributor.stock.adobe.com terlebih dahulu.'
    };
  }

  function findTitleInput() {
    const candidates = deepQueryAll('textarea, input[type="text"], input:not([type])').filter(isVisible);
    return candidates.find(el => {
      const txt = getLabelText(el);
      return /\b(title|judul)\b/.test(txt) && !/\bkeyword/.test(txt);
    }) || null;
  }

  function findKeywordsInput() {
    const candidates = deepQueryAll('textarea, input[type="text"], input:not([type])').filter(isVisible);
    return candidates.find(el => {
      const txt = getLabelText(el);
      return /\b(keyword|keywords|tags)\b/.test(txt);
    }) || null;
  }

  async function selectCategory(categoryName) {
    if (!categoryName) return false;
    const targetLower = categoryName.trim().toLowerCase();

    // 1. Native <select>
    const selects = deepQueryAll('select').filter(isVisible);
    for (const sel of selects) {
      const lbl = getLabelText(sel);
      if (!lbl.includes('category') && selects.length > 1) continue;
      const opt = [...sel.options].find(o => o.textContent.trim().toLowerCase() === targetLower || o.textContent.trim().toLowerCase().includes(targetLower));
      if (opt) {
        setNativeValue(sel, opt.value);
        return true;
      }
    }

    // 2. Custom dropdown / Spectrum Picker button
    const triggers = deepQueryAll('button[aria-haspopup="listbox"], [role="combobox"], sp-picker, [data-testid*="category" i] button')
      .filter(isVisible);
    const catTrigger = triggers.find(el => getLabelText(el).includes('category')) || triggers[0];
    if (!catTrigger) return false;

    catTrigger.click();
    await sleep(220);

    const options = deepQueryAll('[role="option"], sp-menu-item, li[data-value], [role="menuitem"]').filter(isVisible);
    const match = options.find(o => o.textContent.trim().toLowerCase() === targetLower) ||
                  options.find(o => o.textContent.trim().toLowerCase().includes(targetLower));
    if (match) {
      match.click();
      await sleep(120);
      return true;
    }

    // Close menu if not matched
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return false;
  }

  function toggleCheckboxByPattern(pattern, desiredState) {
    const boxes = deepQueryAll('input[type="checkbox"], sp-checkbox, [role="checkbox"]');
    for (const box of boxes) {
      const txt = getLabelText(box);
      const containerTxt = (box.closest('label, [class*="checkbox" i], [class*="field" i], div')?.textContent || '').toLowerCase();
      if (!pattern.test(txt) && !pattern.test(containerTxt)) continue;

      const isChecked = box.tagName === 'INPUT'
        ? box.checked
        : (box.checked === true || box.getAttribute('aria-checked') === 'true' || box.hasAttribute('checked'));

      if (Boolean(isChecked) !== Boolean(desiredState)) {
        box.click();
      }
      return true;
    }
    return false;
  }

  async function fillSingleForm(meta) {
    const filled = { title: false, keywords: false, category: false, aiCheck: false, fictionalCheck: false };

    const titleEl = findTitleInput();
    if (titleEl && meta.title) {
      titleEl.focus();
      setNativeValue(titleEl, meta.title);
      filled.title = true;
    }

    if (meta.category) {
      filled.category = await selectCategory(meta.category);
    }

    const kwEl = findKeywordsInput();
    if (kwEl && Array.isArray(meta.keywords) && meta.keywords.length > 0) {
      const kwString = meta.keywords.slice(0, 49).join(', ');
      kwEl.focus();
      setNativeValue(kwEl, kwString);
      kwEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      kwEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      filled.keywords = true;
    }

    // Adobe Stock Generative AI disclosure checkboxes
    filled.aiCheck = toggleCheckboxByPattern(/generative\s*ai|created using ai/i, meta.isAiGenerated !== false);
    if (meta.isAiGenerated !== false) {
      await sleep(150);
      filled.fictionalCheck = toggleCheckboxByPattern(/fictional/i, Boolean(meta.fictionalPeople));
    }

    return filled;
  }

  function findAssetCards() {
    const selectors = [
      '[data-testid*="asset" i]',
      '[class*="asset-card" i]',
      '[class*="thumbnail" i]',
      '[role="option"]',
      '[role="listitem"]'
    ];
    const cards = [];
    const seen = new Set();
    for (const sel of selectors) {
      for (const el of deepQueryAll(sel)) {
        if (!isVisible(el) || seen.has(el)) continue;
        const txt = (el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '');
        if (/\.(jpe?g|png|svg|eps|ai)\b/i.test(txt) || el.querySelector('img')) {
          seen.add(el);
          cards.push({ el, text: txt.toLowerCase() });
        }
      }
    }
    return cards;
  }

  async function autoFillItems(items = [], mode = 'batch') {
    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, error: 'Tidak ada metadata untuk diisikan.' };
    }

    if (mode === 'active' || items.length === 1) {
      const res = await fillSingleForm(items[0]);
      if (!res.title && !res.keywords) {
        return { ok: false, error: 'Form Title/Keywords Adobe Stock tidak terdeteksi. Pastikan 1 aset sudah diklik/dipilih di panel Upload.' };
      }
      return { ok: true, filledCount: 1, details: [res] };
    }

    const cards = findAssetCards();
    let matchedCount = 0;

    for (const item of items) {
      const candidates = [
        item.exportFilename,
        item.originalName,
        item.baseName
      ].filter(Boolean).map(s => s.toLowerCase());

      const match = cards.find(c => candidates.some(name => c.text.includes(name)));
      if (!match) continue;

      match.el.click();
      await sleep(380);
      const res = await fillSingleForm(item);
      if (res.title || res.keywords) matchedCount++;
    }

    if (matchedCount === 0) {
      // Fallback: fill currently active form with first item if user has 1 item selected
      const res = await fillSingleForm(items[0]);
      if (res.title || res.keywords) {
        return { ok: true, filledCount: 1, note: 'Mengisi aset yang sedang aktif dipilih (cocokkan nama file tidak ditemukan).' };
      }
      return { ok: false, error: 'Tidak ada kartu aset Adobe Stock yang cocok atau form sedang tidak terbuka.' };
    }

    return { ok: true, filledCount: matchedCount };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === 'PING') {
      sendResponse({
        ok: true,
        url: location.href,
        hasFileInput: Boolean(findFileInput()),
        hasMetadataForm: Boolean(findTitleInput() || findKeywordsInput())
      });
      return;
    }

    if (msg.type === 'INJECT_FILES') {
      injectFiles(msg.files)
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (msg.type === 'AUTO_FILL_METADATA') {
      autoFillItems(msg.items, msg.mode)
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  });
})();
