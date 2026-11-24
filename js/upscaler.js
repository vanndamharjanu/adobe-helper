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
 * Pre-cleans JPEG mosquito noise, compression blocks, and dirty white backgrounds
 * at the original resolution BEFORE upscaling so artifacts are never magnified.
 * Uses YCbCr-aware bilateral filtering (stronger chroma deblocking, edge-preserving luma).
 */
function preCleanSourceCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const src = imgData.data;
  const out = new Uint8ClampedArray(src);

  // Detect if image has a predominantly white background from opaque corners
  const cornerCoords = [
    [1, 1], [Math.max(0, w - 2), 1], [1, Math.max(0, h - 2)], [Math.max(0, w - 2), Math.max(0, h - 2)]
  ];
  let whiteCorners = 0;
  for (const [cx, cy] of cornerCoords) {
    const idx = (Math.max(0, Math.min(h - 1, cy)) * w + Math.max(0, Math.min(w - 1, cx))) * 4;
    if (src[idx + 3] >= 128 && src[idx] > 238 && src[idx + 1] > 238 && src[idx + 2] > 238) {
      whiteCorners++;
    }
  }
  const hasWhiteBg = whiteCorners >= 3;

  // 5x5 YCbCr-aware Edge-Preserving Bilateral Filter across all pixels (clamped borders)
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = (row + x) * 4;
      if (src[idx + 3] < 128) continue;
      const r0 = src[idx];
      const g0 = src[idx + 1];
      const b0 = src[idx + 2];

      // Clean near-white JPEG mosquito smudges on white backgrounds
      if (hasWhiteBg && r0 >= 241 && g0 >= 241 && b0 >= 241) {
        const sat = Math.max(r0, g0, b0) - Math.min(r0, g0, b0);
        if (sat <= 12) {
          out[idx] = 255;
          out[idx + 1] = 255;
          out[idx + 2] = 255;
          continue;
        }
      }

      const y0 = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
      const cb0 = -0.1687 * r0 - 0.3313 * g0 + 0.5 * b0;
      const cr0 = 0.5 * r0 - 0.4187 * g0 - 0.0813 * b0;

      let ySum = y0 * 2.5;
      let yWSum = 2.5;
      let cbSum = cb0 * 1.5;
      let crSum = cr0 * 1.5;
      let cWSum = 1.5;

      for (let dy = -2; dy <= 2; dy++) {
        const ny = Math.max(0, Math.min(h - 1, y + dy)) * w;
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nIdx = (ny + Math.max(0, Math.min(w - 1, x + dx))) * 4;
          if (src[nIdx + 3] < 128) continue;
          const nr = src[nIdx];
          const ng = src[nIdx + 1];
          const nb = src[nIdx + 2];

          const nyVal = 0.299 * nr + 0.587 * ng + 0.114 * nb;
          const lumaDiff = Math.abs(nyVal - y0);
          const colorDiff = Math.abs(nr - r0) + Math.abs(ng - g0) + Math.abs(nb - b0);

          // Luma preserves crisp edges; chroma smooths 4:2:0 JPEG color blocks slightly wider
          if (lumaDiff < 14 && colorDiff < 36) {
            const wL = lumaDiff < 6 ? 1.0 : 0.45;
            ySum += nyVal * wL;
            yWSum += wL;
          }
          if (lumaDiff < 20 && colorDiff < 48) {
            const wC = colorDiff < 18 ? 1.0 : 0.5;
            const ncb = -0.1687 * nr - 0.3313 * ng + 0.5 * nb;
            const ncr = 0.5 * nr - 0.4187 * ng - 0.0813 * nb;
            cbSum += ncb * wC;
            crSum += ncr * wC;
            cWSum += wC;
          }
        }
      }

      const yf = ySum / yWSum;
      const cbf = cbSum / cWSum;
      const crf = crSum / cWSum;

      out[idx] = Math.max(0, Math.min(255, Math.round(yf + 1.402 * crf)));
      out[idx + 1] = Math.max(0, Math.min(255, Math.round(yf - 0.34414 * cbf - 0.71414 * crf)));
      out[idx + 2] = Math.max(0, Math.min(255, Math.round(yf + 1.772 * cbf)));
    }
  }

  imgData.data.set(out);
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Separable Float32 Lanczos-3 Resampler with Anti-Ringing Local Min/Max Clamping.
 * Eliminates 8-bit multi-pass banding and preserves crisp detail without ringing halos.
 */
export async function lanczos3Resample(srcData, srcW, srcH, dstW, dstH) {
  if (srcW === dstW && srcH === dstH) {
    return new Uint8ClampedArray(srcData);
  }

  const sinc = x => {
    if (x === 0) return 1;
    const px = Math.PI * x;
    return Math.sin(px) / px;
  };
  const lanczos3 = x => {
    const ax = Math.abs(x);
    return ax < 3 ? sinc(x) * sinc(x / 3) : 0;
  };

  const buildWeights = (inSize, outSize) => {
    const scale = inSize / outSize;
    const support = scale > 1 ? 3 * scale : 3; // shrink uses wider filter to avoid aliasing
    const step = scale > 1 ? 1 / scale : 1;
    const plan = new Array(outSize);
    for (let o = 0; o < outSize; o++) {
      const center = (o + 0.5) * scale - 0.5;
      const left = Math.max(0, Math.ceil(center - support));
      const right = Math.min(inSize - 1, Math.floor(center + support));
      const count = right - left + 1;
      const weights = new Float32Array(count);
      let wSum = 0;
      for (let i = 0; i < count; i++) {
        const w = lanczos3((left + i - center) * step);
        weights[i] = w;
        wSum += w;
      }
      if (wSum > 0) {
        for (let i = 0; i < count; i++) weights[i] /= wSum;
      }
      const c0 = Math.max(0, Math.min(inSize - 1, Math.floor(center)));
      const c1 = Math.max(0, Math.min(inSize - 1, c0 + 1));
      plan[o] = { left, count, weights, c0, c1 };
    }
    return plan;
  };

  const xPlan = buildWeights(srcW, dstW);
  const yPlan = buildWeights(srcH, dstH);

  // Horizontal pass into Float32 RGBA (premultiplied alpha to prevent dark fringes)
  const temp = new Float32Array(dstW * srcH * 4);
  for (let y = 0; y < srcH; y++) {
    const srcRow = y * srcW * 4;
    const dstRow = y * dstW * 4;
    for (let x = 0; x < dstW; x++) {
      const { left, count, weights, c0, c1 } = xPlan[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < count; i++) {
        const w = weights[i];
        const idx = srcRow + (left + i) * 4;
        const alpha = srcData[idx + 3] / 255;
        r += srcData[idx] * alpha * w;
        g += srcData[idx + 1] * alpha * w;
        b += srcData[idx + 2] * alpha * w;
        a += alpha * w;
      }

      // Anti-ringing clamp to nearest 2 source pixels along X
      const i0 = srcRow + c0 * 4;
      const i1 = srcRow + c1 * 4;
      const a0 = srcData[i0 + 3] / 255;
      const a1 = srcData[i1 + 3] / 255;
      const minR = Math.min(srcData[i0] * a0, srcData[i1] * a1);
      const maxR = Math.max(srcData[i0] * a0, srcData[i1] * a1);
      const minG = Math.min(srcData[i0 + 1] * a0, srcData[i1 + 1] * a1);
      const maxG = Math.max(srcData[i0 + 1] * a0, srcData[i1 + 1] * a1);
      const minB = Math.min(srcData[i0 + 2] * a0, srcData[i1 + 2] * a1);
      const maxB = Math.max(srcData[i0 + 2] * a0, srcData[i1 + 2] * a1);

      const dIdx = dstRow + x * 4;
      temp[dIdx] = Math.max(minR, Math.min(maxR, r));
      temp[dIdx + 1] = Math.max(minG, Math.min(maxG, g));
      temp[dIdx + 2] = Math.max(minB, Math.min(maxB, b));
      temp[dIdx + 3] = Math.max(Math.min(a0, a1), Math.min(Math.max(a0, a1), a));
    }
    if (y > 0 && y % 200 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Vertical pass into final Uint8ClampedArray RGBA (un-premultiplying alpha)
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const { left, count, weights, c0, c1 } = yPlan[y];
    const dstRow = y * dstW * 4;
    const r0Base = c0 * dstW * 4;
    const r1Base = c1 * dstW * 4;

    for (let x = 0; x < dstW; x++) {
      const x4 = x * 4;
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < count; i++) {
        const w = weights[i];
        const idx = (left + i) * dstW * 4 + x4;
        r += temp[idx] * w;
        g += temp[idx + 1] * w;
        b += temp[idx + 2] * w;
        a += temp[idx + 3] * w;
      }

      const i0 = r0Base + x4;
      const i1 = r1Base + x4;
      const ca = Math.max(Math.min(temp[i0 + 3], temp[i1 + 3]), Math.min(Math.max(temp[i0 + 3], temp[i1 + 3]), a));
      const cr = Math.max(Math.min(temp[i0], temp[i1]), Math.min(Math.max(temp[i0], temp[i1]), r));
      const cg = Math.max(Math.min(temp[i0 + 1], temp[i1 + 1]), Math.min(Math.max(temp[i0 + 1], temp[i1 + 1]), g));
      const cb = Math.max(Math.min(temp[i0 + 2], temp[i1 + 2]), Math.min(Math.max(temp[i0 + 2], temp[i1 + 2]), b));

      const dIdx = dstRow + x4;
      if (ca > 1e-4) {
        const invA = 1 / ca;
        out[dIdx] = Math.round(Math.max(0, Math.min(255, cr * invA)));
        out[dIdx + 1] = Math.round(Math.max(0, Math.min(255, cg * invA)));
        out[dIdx + 2] = Math.round(Math.max(0, Math.min(255, cb * invA)));
        out[dIdx + 3] = Math.round(Math.max(0, Math.min(255, ca * 255)));
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      }
    }
    if (y > 0 && y % 200 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  return out;
}

/**
 * Applies Scale-Aware Isotropic Edge-Preserving Filter with Hue-Safe Luminance Ratio USM.
 * Prevents stair-stepping on diagonal lines, hue shifts, and ringing halos.
 */
async function applyAdobeQcFilter(canvas, options = {}) {
  const mode = options.profile || 'ai-photorealistic';
  const strength = typeof options.sharpness === 'number' ? options.sharpness : 0.75;
  const denoise = options.denoise !== false;
  const scaleFactor = Math.max(1, options.scaleFactor || 1);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const totalPixels = width * height;

  // Balanced parameters that never over-sharpen or create jagged stair-steps
  let usmAmount = 0.78 * strength;
  let overshootAllowance = 0; // Strict 0 overshoot = zero halo and zero jagged clipping
  let flatThreshold = 3.0;
  let denoiseMix = denoise ? 0.35 : 0;

  if (mode === 'ai-illustration') {
    usmAmount = 0.88 * strength;
    overshootAllowance = 0;
    flatThreshold = 4.5;
    denoiseMix = denoise ? 0.55 : 0;
  } else if (mode === 'ultra-sharp') {
    usmAmount = 1.05 * strength;
    overshootAllowance = 3;
    flatThreshold = 1.8;
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

  // Scale-aware separable Gaussian blur pass (radius scales with upscale ratio, capped 1..3)
  const blurPasses = scaleFactor >= 2.6 ? 3 : scaleFactor >= 1.6 ? 2 : 1;
  let blurSrc = lum;
  const temp = new Float32Array(totalPixels);
  const blurLum = new Float32Array(totalPixels);
  for (let pass = 0; pass < blurPasses; pass++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const xm1 = x > 0 ? x - 1 : x;
        const xp1 = x < width - 1 ? x + 1 : x;
        temp[row + x] = 0.25 * blurSrc[row + xm1] + 0.5 * blurSrc[row + x] + 0.25 * blurSrc[row + xp1];
      }
    }
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
    blurSrc = blurLum;
  }

  // Copy alpha channel
  for (let i = 3; i < src.length; i += 4) {
    out[i] = src[i];
  }

  // Process in row chunks to keep UI responsive on 12MP - 16MP images
  const chunkRows = 240;
  for (let startY = 0; startY < height; startY += chunkRows) {
    const endY = Math.min(height, startY + chunkRows);
    for (let y = startY; y < endY; y++) {
      const ym1 = y > 0 ? y - 1 : 0;
      const yp1 = y < height - 1 ? y + 1 : height - 1;
      const row = y * width;
      const rowUp = ym1 * width;
      const rowDown = yp1 * width;

      for (let x = 0; x < width; x++) {
        const xm1 = x > 0 ? x - 1 : 0;
        const xp1 = x < width - 1 ? x + 1 : width - 1;
        const p = row + x;
        const idx = p * 4;

        const gx = lum[row + xp1] - lum[row + xm1];
        const gy = lum[rowDown + x] - lum[rowUp + x];
        const grad = Math.sqrt(gx * gx + gy * gy);

        const idxUp = (rowUp + x) * 4;
        const idxDown = (rowDown + x) * 4;
        const idxLeft = (row + xm1) * 4;
        const idxRight = (row + xp1) * 4;
        const idxUL = (rowUp + xm1) * 4;
        const idxUR = (rowUp + xp1) * 4;
        const idxDL = (rowDown + xm1) * 4;
        const idxDR = (rowDown + xp1) * 4;

        if (grad < flatThreshold && denoiseMix > 0) {
          // Flat area: isotropic 8-neighbor smoothing to keep surfaces clean
          for (let c = 0; c < 3; c++) {
            const center = src[idx + c];
            const avg =
              0.15 * (src[idxUp + c] + src[idxDown + c] + src[idxLeft + c] + src[idxRight + c]) +
              0.10 * (src[idxUL + c] + src[idxUR + c] + src[idxDL + c] + src[idxDR + c]);
            out[idx + c] = Math.round(center * (1 - denoiseMix) + avg * denoiseMix);
          }
        } else {
          // Edge area: isotropic unsharp mask strictly clamped to 3x3 local [min, max]
          const lCenter = lum[p];
          const lumDelta = (lCenter - blurLum[p]) * usmAmount;

          const minL = Math.min(
            lCenter,
            lum[rowUp + x], lum[rowDown + x], lum[row + xm1], lum[row + xp1],
            lum[rowUp + xm1], lum[rowUp + xp1], lum[rowDown + xm1], lum[rowDown + xp1]
          );
          const maxL = Math.max(
            lCenter,
            lum[rowUp + x], lum[rowDown + x], lum[row + xm1], lum[row + xp1],
            lum[rowUp + xm1], lum[rowUp + xp1], lum[rowDown + xm1], lum[rowDown + xp1]
          );

          const targetLum = Math.max(
            minL - overshootAllowance,
            Math.min(maxL + overshootAllowance, lCenter + lumDelta)
          );

          // Hue-preserving luminance scaling on midtones/highlights, additive fallback near black
          if (lCenter > 12) {
            const ratio = targetLum / lCenter;
            for (let c = 0; c < 3; c++) {
              out[idx + c] = Math.max(0, Math.min(255, Math.round(src[idx + c] * ratio)));
            }
          } else {
            const appliedDelta = targetLum - lCenter;
            for (let c = 0; c < 3; c++) {
              out[idx + c] = Math.max(0, Math.min(255, Math.round(src[idx + c] + appliedDelta)));
            }
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
 * High-Precision Lanczos-3 Anti-Ringing Upscaler with Pre-Denoising
 */
export async function upscaleImage(sourceUrl, origW, origH, settings = {}) {
  const img = typeof sourceUrl === 'string' ? await loadImageElement(sourceUrl) : sourceUrl;
  const scalePreset = settings.targetScale || '8mp';
  const { width: targetW, height: targetH, megapixels } = computeTargetDimensions(origW, origH, scalePreset);

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = origW;
  srcCanvas.height = origH;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.drawImage(img, 0, 0, origW, origH);

  // Step 1: Clean JPEG mosquito noise and compression smudges at original resolution BEFORE upscaling
  preCleanSourceCanvas(srcCanvas);

  // Step 2: Single-pass Float32 Lanczos-3 resampling with Anti-Ringing Clamping
  const srcImageData = srcCtx.getImageData(0, 0, origW, origH);
  const resampled = await lanczos3Resample(srcImageData.data, origW, origH, targetW, targetH);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const dstImgData = new ImageData(resampled, targetW, targetH);
  ctx.putImageData(dstImgData, 0, 0);

  // Step 3: Scale-aware isotropic edge-restoration pass at target resolution
  await applyAdobeQcFilter(canvas, {
    profile: settings.profile || 'ai-photorealistic',
    sharpness: settings.sharpness ?? 0.75,
    denoise: settings.denoise !== false,
    scaleFactor: Math.max(1, targetW / origW)
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

function colorDistRgb(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function colorDistPct(r, g, b, bg) {
  return (colorDistRgb(r, g, b, bg[0], bg[1], bg[2]) / 441.67) * 100;
}

/**
 * Finds the dominant background color along all 4 image edges via 4-bit color histogram
 */
function detectDominantBorderColor(data, w, h) {
  const bins = new Map();
  const samplePixel = (x, y) => {
    const idx = (y * w + x) * 4;
    if (data[idx + 3] < 128) return;
    const key = ((data[idx] >> 4) << 8) | ((data[idx + 1] >> 4) << 4) | (data[idx + 2] >> 4);
    let bin = bins.get(key);
    if (!bin) {
      bin = [0, 0, 0, 0];
      bins.set(key, bin);
    }
    bin[0] += data[idx];
    bin[1] += data[idx + 1];
    bin[2] += data[idx + 2];
    bin[3]++;
  };

  for (let x = 0; x < w; x++) {
    samplePixel(x, 0);
    if (h > 1) samplePixel(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    samplePixel(0, y);
    if (w > 1) samplePixel(w - 1, y);
  }

  if (bins.size === 0) return [255, 255, 255];
  let best = null;
  for (const bin of bins.values()) {
    if (!best || bin[3] > best[3]) best = bin;
  }
  return [
    Math.round(best[0] / best[3]),
    Math.round(best[1] / best[3]),
    Math.round(best[2] / best[3])
  ];
}

/**
 * Clears newly removed pixels and decontaminates anti-aliased boundary pixels
 * without leaking transparency into solid interior colors.
 */
function applyBoundaryMatte(data, orig, newlyRemoved, fullMask, w, h, bg, tolerance, fillWhite) {
  const total = w * h;

  for (let p = 0; p < total; p++) {
    if (!newlyRemoved[p]) continue;
    const idx = p * 4;
    if (fillWhite) {
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    } else {
      data[idx] = 0;
      data[idx + 1] = 0;
      data[idx + 2] = 0;
      data[idx + 3] = 0;
    }
  }

  const band = [];
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const p = row + x;
      if (fullMask[p] || orig[p * 4 + 3] < 128) continue;

      let immediate = false;
      let near = false;
      for (let dy = -2; dy <= 2 && !immediate; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        const nRow = ny * w;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (newlyRemoved[nRow + nx]) {
            near = true;
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
              immediate = true;
              break;
            }
          }
        }
      }
      if (!near) continue;
      if (immediate || colorDistPct(orig[p * 4], orig[p * 4 + 1], orig[p * 4 + 2], bg) <= tolerance * 1.4) {
        band.push(p, immediate ? 1 : 0);
      }
    }
  }

  const updates = [];
  for (let bIdx = 0; bIdx < band.length; bIdx += 2) {
    const p = band[bIdx];
    const isImmediate = band[bIdx + 1] === 1;
    const x = p % w;
    const y = (p - x) / w;
    const i = p * 4;

    const findBestFg = (radius) => {
      let bestScore = -1;
      let bestQ = -1;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        const nRow = ny * w;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = nRow + nx;
          if (fullMask[q] || orig[q * 4 + 3] < 128) continue;
          const qi = q * 4;
          const dist = colorDistRgb(orig[qi], orig[qi + 1], orig[qi + 2], bg[0], bg[1], bg[2]);
          if (dist < 42) continue;
          const score = dist - (dx * dx + dy * dy) * 2;
          if (score > bestScore) {
            bestScore = score;
            bestQ = q;
          }
        }
      }
      return bestQ;
    };

    let f = findBestFg(2);
    if (f < 0) f = findBestFg(4);

    if (f >= 0) {
      const j = f * 4;
      const vx = orig[j] - bg[0];
      const vy = orig[j + 1] - bg[1];
      const vz = orig[j + 2] - bg[2];
      const vLenSq = vx * vx + vy * vy + vz * vz;
      const cx = orig[i] - bg[0];
      const cy = orig[i + 1] - bg[1];
      const cz = orig[i + 2] - bg[2];
      const a = Math.max(0, Math.min(1, (cx * vx + cy * vy + cz * vz) / vLenSq));

      const rx = cx - a * vx;
      const ry = cy - a * vy;
      const rz = cz - a * vz;
      const perpDist = Math.sqrt(rx * rx + ry * ry + rz * rz);

      if (perpDist <= 42 && a < 0.98) {
        if (fillWhite) {
          updates.push(
            i,
            Math.round(orig[j] * a + 255 * (1 - a)),
            Math.round(orig[j + 1] * a + 255 * (1 - a)),
            Math.round(orig[j + 2] * a + 255 * (1 - a)),
            255
          );
        } else if (a < 0.04) {
          updates.push(i, 0, 0, 0, 0);
        } else {
          updates.push(i, orig[j], orig[j + 1], orig[j + 2], Math.round(a * orig[i + 3]));
        }
      }
    } else if (isImmediate) {
      const distPct = colorDistPct(orig[i], orig[i + 1], orig[i + 2], bg);
      if (distPct <= tolerance * 1.2) {
        const a = Math.max(0, Math.min(1, distPct / (tolerance * 1.2)));
        if (fillWhite) {
          updates.push(
            i,
            Math.round(orig[i] * a + 255 * (1 - a)),
            Math.round(orig[i + 1] * a + 255 * (1 - a)),
            Math.round(orig[i + 2] * a + 255 * (1 - a)),
            255
          );
        } else {
          updates.push(i, orig[i], orig[i + 1], orig[i + 2], Math.round(a * orig[i + 3]));
        }
      }
    }
  }

  for (let u = 0; u < updates.length; u += 5) {
    const i = updates[u];
    data[i] = updates[u + 1];
    data[i + 1] = updates[u + 2];
    data[i + 2] = updates[u + 3];
    data[i + 3] = updates[u + 4];
  }
}

function autoCenterCutoutCanvas(srcCanvas, fillWhite, paddingRatio = 0.08) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const ctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, w, h).data;

  let minX = w, minY = h, maxX = -1, maxY = -1, fgCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const isFg = fillWhite
        ? (data[idx] < 245 || data[idx + 1] < 245 || data[idx + 2] < 245)
        : (data[idx + 3] >= 24);
      if (isFg) {
        fgCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (fgCount < 64 || maxX <= minX || maxY <= minY) return srcCanvas;

  const objW = maxX - minX + 1;
  const objH = maxY - minY + 1;
  const maxContentW = Math.max(1, Math.round(w * (1 - paddingRatio * 2)));
  const maxContentH = Math.max(1, Math.round(h * (1 - paddingRatio * 2)));
  const fitScale = Math.min(1, maxContentW / objW, maxContentH / objH);
  const drawW = Math.max(1, Math.round(objW * fitScale));
  const drawH = Math.max(1, Math.round(objH * fitScale));
  const dstX = Math.round((w - drawW) / 2);
  const dstY = Math.round((h - drawH) / 2);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const outCtx = outCanvas.getContext('2d');
  if (fillWhite) {
    outCtx.fillStyle = '#FFFFFF';
    outCtx.fillRect(0, 0, w, h);
  }
  outCtx.imageSmoothingEnabled = true;
  outCtx.imageSmoothingQuality = 'high';
  outCtx.drawImage(srcCanvas, minX, minY, objW, objH, dstX, dstY, drawW, drawH);
  return outCanvas;
}

function renderCanvasToCutoutResult(canvas, fillWhite) {
  const mime = fillWhite ? 'image/jpeg' : 'image/png';
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) return reject(new Error('Gagal mengekspor gambar hasil isolasi.'));
        resolve({
          changed: true,
          blob,
          url: URL.createObjectURL(blob),
          width: canvas.width,
          height: canvas.height,
          isTransparent: !fillWhite
        });
      },
      mime,
      fillWhite ? 0.96 : undefined
    );
  });
}

/**
 * Smart Background Removal (Border Histogram + Flood Fill + Optional Internal Holes + Edge Matting)
 */
export async function isolateSubjectBackground(sourceUrl, options = {}) {
  const tolerance = Math.max(5, Math.min(65, options.tolerance ?? 16));
  const fillWhite = options.fillWhite === true;
  const removeInternalHoles = options.removeInternalHoles === true;
  const autoCenter = options.autoCenter === true;
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
  const orig = new Uint8ClampedArray(data);
  const total = w * h;

  const bg = detectDominantBorderColor(orig, w, h);
  const visited = new Uint8Array(total);
  const newlyRemoved = new Uint8Array(total);
  const fullMask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0, tail = 0;

  const tryEnqueue = (x, y) => {
    const p = y * w + x;
    if (visited[p] !== 0) return;
    const idx = p * 4;
    const isAlreadyAlpha = orig[idx + 3] < 128;
    if (isAlreadyAlpha || colorDistPct(orig[idx], orig[idx + 1], orig[idx + 2], bg) <= tolerance) {
      visited[p] = 1;
      fullMask[p] = 1;
      if (!isAlreadyAlpha) newlyRemoved[p] = 1;
      queue[tail++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    tryEnqueue(x, 0);
    if (h > 1) tryEnqueue(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    tryEnqueue(0, y);
    if (w > 1) tryEnqueue(w - 1, y);
  }

  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) tryEnqueue(x - 1, y);
    if (x < w - 1) tryEnqueue(x + 1, y);
    if (y > 0) tryEnqueue(x, y - 1);
    if (y < h - 1) tryEnqueue(x, y + 1);
  }

  if (removeInternalHoles) {
    const holeTol = Math.max(5, tolerance * 0.9);
    for (let p = 0; p < total; p++) {
      if (visited[p]) continue;
      const idx = p * 4;
      if (orig[idx + 3] < 128) {
        fullMask[p] = 1;
        continue;
      }
      if (colorDistPct(orig[idx], orig[idx + 1], orig[idx + 2], bg) <= holeTol) {
        visited[p] = 1;
        fullMask[p] = 1;
        newlyRemoved[p] = 1;
      }
    }
  } else {
    for (let p = 0; p < total; p++) {
      if (!fullMask[p] && orig[p * 4 + 3] < 128) fullMask[p] = 1;
    }
  }

  applyBoundaryMatte(data, orig, newlyRemoved, fullMask, w, h, bg, tolerance, fillWhite);
  ctx.putImageData(imgData, 0, 0);
  const outCanvas = autoCenter ? autoCenterCutoutCanvas(canvas, fillWhite, 0.08) : canvas;
  return renderCanvasToCutoutResult(outCanvas, fillWhite);
}

/**
 * Interactive Magic Wand: Flood-erases the connected color region at (startX, startY)
 * and cleanly decontaminates only the newly created cutout edges.
 */
export async function eraseBackgroundAtPoint(sourceUrl, startX, startY, options = {}) {
  const tolerance = Math.max(5, Math.min(65, options.tolerance ?? 16));
  const fillWhite = options.fillWhite === true;
  const img = typeof sourceUrl === 'string' ? await loadImageElement(sourceUrl) : sourceUrl;

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const sx = Math.max(0, Math.min(w - 1, Math.round(startX)));
  const sy = Math.max(0, Math.min(h - 1, Math.round(startY)));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const orig = new Uint8ClampedArray(data);
  const total = w * h;

  const startIdx = (sy * w + sx) * 4;
  if (orig[startIdx + 3] < 128) {
    return { changed: false };
  }

  const targetBg = [orig[startIdx], orig[startIdx + 1], orig[startIdx + 2]];
  const newlyRemoved = new Uint8Array(total);
  const fullMask = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (orig[p * 4 + 3] < 128) fullMask[p] = 1;
  }

  const queue = new Int32Array(total);
  let head = 0, tail = 0;
  const startP = sy * w + sx;
  newlyRemoved[startP] = 1;
  fullMask[startP] = 1;
  queue[tail++] = startP;

  const tryEnqueue = (x, y) => {
    const p = y * w + x;
    if (fullMask[p]) return;
    const idx = p * 4;
    if (colorDistPct(orig[idx], orig[idx + 1], orig[idx + 2], targetBg) <= tolerance) {
      newlyRemoved[p] = 1;
      fullMask[p] = 1;
      queue[tail++] = p;
    }
  };

  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) tryEnqueue(x - 1, y);
    if (x < w - 1) tryEnqueue(x + 1, y);
    if (y > 0) tryEnqueue(x, y - 1);
    if (y < h - 1) tryEnqueue(x, y + 1);
  }

  applyBoundaryMatte(data, orig, newlyRemoved, fullMask, w, h, targetBg, tolerance, fillWhite);
  ctx.putImageData(imgData, 0, 0);
  return renderCanvasToCutoutResult(canvas, fillWhite);
}

/**
 * Smart Grid Splitter & Auto-Centering Cropper
 * Supports 2x2, 3x3, 2x3, 3x2, or custom NxM grids.
 * Automatically finds clean gutters between icons/illustrations (or photo grids),
 * detects tight bounding boxes, and centers isolated icons on a clean padded canvas.
 */
export async function splitImageGrid(sourceUrl, cols = 2, rows = 2, mimeType = 'image/png') {
  cols = Math.max(1, parseInt(cols, 10) || 2);
  rows = Math.max(1, parseInt(rows, 10) || 2);

  const img = typeof sourceUrl === 'string' ? await loadImageElement(sourceUrl) : sourceUrl;
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w;
  srcCanvas.height = h;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.drawImage(img, 0, 0, w, h);

  // Clean JPEG compression smudges before detecting & splitting
  preCleanSourceCanvas(srcCanvas);

  const imgData = srcCtx.getImageData(0, 0, w, h).data;

  // Detect background color from corners & border samples
  const corners = [
    [2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3],
    [Math.floor(w / 2), 2], [Math.floor(w / 2), h - 3],
    [2, Math.floor(h / 2)], [w - 3, Math.floor(h / 2)]
  ];
  let bgR = 0, bgG = 0, bgB = 0;
  let transparentCorners = 0;
  for (const [cx, cy] of corners) {
    const idx = (Math.max(0, Math.min(h - 1, cy)) * w + Math.max(0, Math.min(w - 1, cx))) * 4;
    if (imgData[idx + 3] < 30) {
      transparentCorners++;
    } else {
      bgR += imgData[idx];
      bgG += imgData[idx + 1];
      bgB += imgData[idx + 2];
    }
  }
  const opaqueCount = corners.length - transparentCorners;
  if (opaqueCount > 0) {
    bgR = Math.round(bgR / opaqueCount);
    bgG = Math.round(bgG / opaqueCount);
    bgB = Math.round(bgB / opaqueCount);
  } else {
    bgR = 255; bgG = 255; bgB = 255;
  }
  const isSourceTransparent = transparentCorners >= corners.length / 2;

  const isForeground = (x, y) => {
    const idx = (y * w + x) * 4;
    if (imgData[idx + 3] < 30) return false;
    if (isSourceTransparent) return true;
    const diff = Math.abs(imgData[idx] - bgR) + Math.abs(imgData[idx + 1] - bgG) + Math.abs(imgData[idx + 2] - bgB);
    return diff > 36;
  };

  // Find vertical gutters between columns
  const bestXs = [];
  const cellW = w / cols;
  const searchRadiusX = Math.floor(cellW * 0.30);

  for (let c = 1; c < cols; c++) {
    const targetX = Math.round((c * w) / cols);
    const minX = Math.max(1, targetX - searchRadiusX);
    const maxX = Math.min(w - 2, targetX + searchRadiusX);

    let bestX = targetX;
    let minScore = Infinity;
    for (let x = minX; x <= maxX; x++) {
      let fgCount = 0;
      for (let y = 0; y < h; y += 2) {
        if (isForeground(x, y)) fgCount++;
      }
      const centerBias = Math.abs(x - targetX) * 0.05;
      const score = fgCount + centerBias;
      if (score < minScore) {
        minScore = score;
        bestX = x;
      }
    }
    bestXs.push(bestX);
  }

  // Find horizontal gutters between rows
  const bestYs = [];
  const cellH = h / rows;
  const searchRadiusY = Math.floor(cellH * 0.30);

  for (let r = 1; r < rows; r++) {
    const targetY = Math.round((r * h) / rows);
    const minY = Math.max(1, targetY - searchRadiusY);
    const maxY = Math.min(h - 2, targetY + searchRadiusY);

    let bestY = targetY;
    let minScore = Infinity;
    for (let y = minY; y <= maxY; y++) {
      let fgCount = 0;
      for (let x = 0; x < w; x += 2) {
        if (isForeground(x, y)) fgCount++;
      }
      const centerBias = Math.abs(y - targetY) * 0.05;
      const score = fgCount + centerBias;
      if (score < minScore) {
        minScore = score;
        bestY = y;
      }
    }
    bestYs.push(bestY);
  }

  const splitXs = [0, ...bestXs, w];
  const splitYs = [0, ...bestYs, h];

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        x0: splitXs[c],
        y0: splitYs[r],
        x1: splitXs[c + 1],
        y1: splitYs[r + 1],
        row: r,
        col: c
      });
    }
  }

  const results = [];
  const isLightBg = bgR > 235 && bgG > 235 && bgB > 235;

  for (let i = 0; i < cells.length; i++) {
    const q = cells[i];
    const qw = q.x1 - q.x0;
    const qh = q.y1 - q.y0;

    // Detect tight bounding box of foreground object inside this cell
    let minX = q.x1, minY = q.y1, maxX = q.x0, maxY = q.y0;
    let fgPixels = 0;
    for (let y = q.y0; y < q.y1; y++) {
      for (let x = q.x0; x < q.x1; x++) {
        if (isForeground(x, y)) {
          fgPixels++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const outCanvas = document.createElement('canvas');
    const hasIsolatedObject = fgPixels > 60 && (maxX > minX) && (maxY > minY) && ((maxX - minX) < qw * 0.98 || (maxY - minY) < qh * 0.98);

    if (hasIsolatedObject) {
      // Center the detected icon/object cleanly with 28% padding
      const objW = maxX - minX + 1;
      const objH = maxY - minY + 1;
      const side = Math.round(Math.max(objW, objH) * 1.28);
      const canvasDim = Math.max(side, Math.max(qw, qh));
      outCanvas.width = canvasDim;
      outCanvas.height = canvasDim;

      const outCtx = outCanvas.getContext('2d');
      if (!isSourceTransparent) {
        outCtx.fillStyle = isLightBg ? '#FFFFFF' : `rgb(${bgR}, ${bgG}, ${bgB})`;
        outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
      }

      const dstX = Math.round((outCanvas.width - objW) / 2);
      const dstY = Math.round((outCanvas.height - objH) / 2);
      outCtx.drawImage(srcCanvas, minX, minY, objW, objH, dstX, dstY, objW, objH);
    } else {
      // Full cell crop
      outCanvas.width = qw;
      outCanvas.height = qh;
      const outCtx = outCanvas.getContext('2d');
      outCtx.drawImage(srcCanvas, q.x0, q.y0, qw, qh, 0, 0, qw, qh);
    }

    // Always export split crops as lossless PNG to avoid double-JPEG compression artifacts
    const blob = await new Promise((resolve, reject) => {
      outCanvas.toBlob(b => (b ? resolve(b) : reject(new Error('Gagal memotong bagian gambar.'))), 'image/png');
    });

    results.push({
      index: i + 1,
      row: q.row,
      col: q.col,
      blob,
      url: URL.createObjectURL(blob),
      width: outCanvas.width,
      height: outCanvas.height
    });
  }

  return results;
}

export async function splitImageIntoQuadrants(sourceUrl, mimeType = 'image/jpeg') {
  return splitImageGrid(sourceUrl, 2, 2, mimeType);
}


