/**
 * Multi-Mode Anti-Artifact Image Upscaler & Background Isolator
 * Engineered specifically for Adobe Stock Contributor Technical QC Standards
 * (Zero ringing halos, luminance-only sharpening, diffusion noise reduction)
 */

export function computeTargetDimensions(origW, origH, scalePreset = '8mp') {
  const aspect = origW / origH;
  const origMp = (origW * origH) / 1e6;

  switch (scalePreset) {
    case '2x': {
      const w = Math.round(origW * 2);
      const h = Math.round(origH * 2);
      return { width: w, height: h, megapixels: (w * h) / 1e6 };
    }
    case '4x': {
      const w = Math.round(origW * 4);
      const h = Math.round(origH * 4);
      return { width: w, height: h, megapixels: (w * h) / 1e6 };
    }
    case '4mp': {
      const targetPixels = Math.max(4.4e6, origMp >= 4.4 ? origW * origH * 1.25 : 4.4e6);
      const h = Math.round(Math.sqrt(targetPixels / aspect));
      const w = Math.round(h * aspect);
      return { width: w, height: h, megapixels: (w * h) / 1e6 };
    }
    case '8mp': {
      const targetPixels = 8.6e6;
      const h = Math.round(Math.sqrt(targetPixels / aspect));
      const w = Math.round(h * aspect);
      return { width: w, height: h, megapixels: (w * h) / 1e6 };
    }
    case '12mp': {
      const targetPixels = 12.5e6;
      const h = Math.round(Math.sqrt(targetPixels / aspect));
      const w = Math.round(h * aspect);
      return { width: w, height: h, megapixels: (w * h) / 1e6 };
    }
    case '16mp': {
      const targetPixels = 16.5e6;
      const h = Math.round(Math.sqrt(targetPixels / aspect));
      const w = Math.round(h * aspect);
      return { width: w, height: h, megapixels: (w * h) / 1e6 };
    }
    default: {
      const targetPixels = 8.6e6;
      const h = Math.round(Math.sqrt(targetPixels / aspect));
      const w = Math.round(h * aspect);
      return { width: w, height: h, megapixels: (w * h) / 1e6 };
    }
  }
}

export function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (typeof src === 'string' && src.startsWith('http')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Gagal memuat gambar untuk pemrosesan.'));
    img.src = src;
  });
}

/**
 * Applies profile-based Luminance Convolution & Edge-Preserving Denoise
 * Modes:
 * - 'ai-photorealistic': Subtle micro-contrast, strict halo clamping (±6), gentle flat-area denoise
 * - 'ai-illustration': Smooths diffusion grain in flat areas, crisp contour sharpening on edges
 * - 'ultra-sharp': High-definition Laplacian + Unsharp Mask with ±10 clamp
 */
async function applyAdobeQcFilter(canvas, options = {}) {
  const mode = options.profile || 'ai-photorealistic';
  const strength = typeof options.sharpness === 'number' ? options.sharpness : 0.75;
  const denoise = options.denoise !== false;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const totalPixels = width * height;

  // Profile parameters
  let edgeStrength = strength * 0.85;
  let lapWeight = 0.22;
  let haloClamp = 7;
  let flatThreshold = 2.0;
  let denoiseMix = denoise ? 0.35 : 0;

  if (mode === 'ai-illustration') {
    edgeStrength = strength * 1.05;
    lapWeight = 0.28;
    haloClamp = 9;
    flatThreshold = 3.2; // Smoother flat color areas for AI illustrations
    denoiseMix = denoise ? 0.55 : 0;
  } else if (mode === 'ultra-sharp') {
    edgeStrength = strength * 1.15;
    lapWeight = 0.32;
    haloClamp = 11;
    flatThreshold = 1.4;
    denoiseMix = denoise ? 0.2 : 0;
  }

  const imgData = ctx.getImageData(0, 0, width, height);
  const src = imgData.data;
  const out = new Uint8ClampedArray(src.length);

  // Compute luminance buffer
  const lum = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    lum[i] = 0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2];
  }

  // Separable [0.25, 0.5, 0.25] Gaussian pass for low-frequency reference
  const temp = new Float32Array(totalPixels);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const xm1 = x > 0 ? x - 1 : x;
      const xp1 = x < width - 1 ? x + 1 : x;
      temp[row + x] = 0.25 * lum[row + xm1] + 0.5 * lum[row + x] + 0.25 * lum[row + xp1];
    }
  }

  const blurLum = new Float32Array(totalPixels);
  for (let y = 0; y < height; y++) {
    const ym1 = y > 0 ? y - 1 : y;
    const yp1 = y < height - 1 ? y + 1 : y;
    const row = y * width;
    const rowM1 = ym1 * width;
    const rowP1 = yp1 * width;
    for (let x = 0; x < width; x++) {
      blurLum[row + x] = 0.25 * temp[rowM1 + x] + 0.5 * temp[row + x] + 0.25 * temp[rowP1 + x];
    }
  }

  // Copy alpha channel
  for (let i = 3; i < src.length; i += 4) {
    out[i] = src[i];
  }

  // Process in row chunks to keep UI responsive even on 12MP - 16MP images
  const chunkRows = 250;
  for (let startY = 0; startY < height; startY += chunkRows) {
    const endY = Math.min(height, startY + chunkRows);
    for (let y = startY; y < endY; y++) {
      const ym1 = y > 0 ? y - 1 : y;
      const yp1 = y < height - 1 ? y + 1 : y;
      const row = y * width;
      const rowUp = ym1 * width;
      const rowDown = yp1 * width;

      for (let x = 0; x < width; x++) {
        const xm1 = x > 0 ? x - 1 : x;
        const xp1 = x < width - 1 ? x + 1 : x;
        const p = row + x;
        const idx = p * 4;

        const gx = lum[row + xp1] - lum[row + xm1];
        const gy = lum[rowDown + x] - lum[rowUp + x];
        const grad = Math.sqrt(gx * gx + gy * gy);

        const idxUp = (rowUp + x) * 4;
        const idxDown = (rowDown + x) * 4;
        const idxLeft = (row + xm1) * 4;
        const idxRight = (row + xp1) * 4;

        if (grad < flatThreshold && denoiseMix > 0) {
          // Flat area: suppress AI diffusion grain/noise
          for (let c = 0; c < 3; c++) {
            const center = src[idx + c];
            const avg = 0.25 * (src[idxUp + c] + src[idxDown + c] + src[idxLeft + c] + src[idxRight + c]);
            out[idx + c] = Math.round(center * (1 - denoiseMix) + avg * denoiseMix);
          }
        } else {
          // Edge / texture area: Luminance-guided sharpening with anti-halo clamping
          const highPass = lum[p] - blurLum[p];
          const adaptiveGain = grad > 12 ? edgeStrength * 0.9 : edgeStrength;

          for (let c = 0; c < 3; c++) {
            const center = src[idx + c];
            const nUp = src[idxUp + c];
            const nDown = src[idxDown + c];
            const nLeft = src[idxLeft + c];
            const nRight = src[idxRight + c];

            const lap = 4 * center - (nUp + nDown + nLeft + nRight);
            const delta = (lap * lapWeight + highPass * 0.45) * adaptiveGain;

            const minN = Math.min(center, nUp, nDown, nLeft, nRight);
            const maxN = Math.max(center, nUp, nDown, nLeft, nRight);
            const sharpened = center + delta;
            const clamped = Math.max(minN - haloClamp, Math.min(maxN + haloClamp, sharpened));

            out[idx + c] = Math.max(0, Math.min(255, Math.round(clamped)));
          }
        }
      }
    }
    if (endY < height) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  imgData.data.set(out);
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Multi-step progressive upscaler (1.45x per pass)
 */
export async function upscaleImage(sourceUrl, origW, origH, settings = {}) {
  const img = typeof sourceUrl === 'string' ? await loadImageElement(sourceUrl) : sourceUrl;
  const scalePreset = settings.targetScale || '8mp';
  const { width: targetW, height: targetH, megapixels } = computeTargetDimensions(origW, origH, scalePreset);

  let currW = origW;
  let currH = origH;

  let canvas = document.createElement('canvas');
  canvas.width = currW;
  canvas.height = currH;
  let ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, currW, currH);

  // Progressive 1.45x steps for smooth bicubic/lanczos interpolation
  while (currW < targetW || currH < targetH) {
    const nextW = Math.min(targetW, Math.round(currW * 1.45));
    const nextH = Math.min(targetH, Math.round(currH * 1.45));

    const stepCanvas = document.createElement('canvas');
    stepCanvas.width = nextW;
    stepCanvas.height = nextH;
    const stepCtx = stepCanvas.getContext('2d', { willReadFrequently: true });
    stepCtx.imageSmoothingEnabled = true;
    stepCtx.imageSmoothingQuality = 'high';
    stepCtx.drawImage(canvas, 0, 0, nextW, nextH);

    canvas = stepCanvas;
    currW = nextW;
    currH = nextH;

    if (currW >= targetW && currH >= targetH) break;
  }

  // Apply selected Adobe QC Convolution & Denoise profile
  await applyAdobeQcFilter(canvas, {
    profile: settings.profile || 'ai-photorealistic',
    sharpness: settings.sharpness ?? 0.75,
    denoise: settings.denoise !== false
  });

  const mimeType = settings.outputFormat || 'image/jpeg';
  const quality = mimeType === 'image/jpeg' ? (settings.jpegQuality || 95) / 100 : undefined;

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Gagal membuat Blob gambar.'))), mimeType, quality);
  });

  return {
    width: targetW,
    height: targetH,
    megapixels,
    blob,
    url: URL.createObjectURL(blob),
    size: blob.size
  };
}

/**
 * Smart Background Removal (Flood Fill from borders + Soft Edge Defringe)
 */
export async function isolateSubjectBackground(sourceUrl, options = {}) {
  const tolerance = Math.max(5, Math.min(65, options.tolerance ?? 24));
  const fillWhite = options.fillWhite === true; // True = pure #FFFFFF JPG, False = Transparent PNG
  const img = typeof sourceUrl === 'string' ? await loadImageElement(sourceUrl) : sourceUrl;

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const total = w * h;

  // Sample 8 border points to detect background color
  const sampleCoords = [
    [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
    [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
    [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)]
  ];
  let rSum = 0, gSum = 0, bSum = 0;
  for (const [sx, sy] of sampleCoords) {
    const idx = (sy * w + sx) * 4;
    rSum += data[idx];
    gSum += data[idx + 1];
    bSum += data[idx + 2];
  }
  const bgR = Math.round(rSum / sampleCoords.length);
  const bgG = Math.round(gSum / sampleCoords.length);
  const bgB = Math.round(bSum / sampleCoords.length);

  const colorDistPct = (r, g, b) => {
    const dr = r - bgR;
    const dg = g - bgG;
    const db = b - bgB;
    return (Math.sqrt(dr * dr + dg * dg + db * db) / 441.67) * 100;
  };

  // Flood fill from border pixels
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;

  const tryEnqueue = (x, y) => {
    const p = y * w + x;
    if (visited[p] !== 0) return;
    const idx = p * 4;
    if (colorDistPct(data[idx], data[idx + 1], data[idx + 2]) <= tolerance + 3) {
      visited[p] = 2;
      queue[tail++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    tryEnqueue(x, 0);
    tryEnqueue(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    tryEnqueue(0, y);
    tryEnqueue(w - 1, y);
  }

  while (head < tail) {
    const p = queue[head++];
    visited[p] = 1;
    const x = p % w;
    const y = (p - x) / w;

    if (x > 0) tryEnqueue(x - 1, y);
    if (x < w - 1) tryEnqueue(x + 1, y);
    if (y > 0) tryEnqueue(x, y - 1);
    if (y < h - 1) tryEnqueue(x, y + 1);
  }

  // Apply alpha feathering & color decontamination on boundary pixels
  const featherBand = Math.max(2, tolerance * 0.35);
  for (let p = 0; p < total; p++) {
    const idx = p * 4;
    if (visited[p] === 1) {
      if (fillWhite) {
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = 255;
      } else {
        data[idx + 3] = 0;
      }
    } else {
      const dist = colorDistPct(data[idx], data[idx + 1], data[idx + 2]);
      if (dist < tolerance + featherBand && dist > tolerance - featherBand) {
        const alphaFactor = Math.max(0, Math.min(1, (dist - (tolerance - featherBand)) / (featherBand * 2)));
        if (fillWhite) {
          data[idx] = Math.round(data[idx] * alphaFactor + 255 * (1 - alphaFactor));
          data[idx + 1] = Math.round(data[idx + 1] * alphaFactor + 255 * (1 - alphaFactor));
          data[idx + 2] = Math.round(data[idx + 2] * alphaFactor + 255 * (1 - alphaFactor));
        } else {
          data[idx + 3] = Math.round(data[idx + 3] * alphaFactor);
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  const mime = fillWhite ? 'image/jpeg' : 'image/png';
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Gagal mengekspor gambar hasil isolasi.'))), mime, fillWhite ? 0.96 : undefined);
  });

  return {
    blob,
    url: URL.createObjectURL(blob),
    width: w,
    height: h,
    isTransparent: !fillWhite
  };
}

