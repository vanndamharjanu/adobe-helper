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
 */
function preCleanSourceCanvas(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const src = imgData.data;
  const out = new Uint8ClampedArray(src);

  // Detect if image has a predominantly white background from corners
  const cornerCoords = [
    [1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]
  ];
  let whiteCorners = 0;
  for (const [cx, cy] of cornerCoords) {
    const idx = (Math.max(0, cy) * w + Math.max(0, cx)) * 4;
    if (src[idx] > 238 && src[idx + 1] > 238 && src[idx + 2] > 238) {
      whiteCorners++;
    }
  }
  const hasWhiteBg = whiteCorners >= 3;

  // 5x5 Edge-Preserving Bilateral Filter to remove JPEG mosquito noise around lines
  for (let y = 2; y < h - 2; y++) {
    const row = y * w;
    for (let x = 2; x < w - 2; x++) {
      const idx = (row + x) * 4;
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

      let rSum = r0 * 2;
      let gSum = g0 * 2;
      let bSum = b0 * 2;
      let wSum = 2;

      for (let dy = -2; dy <= 2; dy++) {
        const ny = (y + dy) * w;
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nIdx = (ny + x + dx) * 4;
          const nr = src[nIdx];
          const ng = src[nIdx + 1];
          const nb = src[nIdx + 2];

          const colorDiff = Math.abs(nr - r0) + Math.abs(ng - g0) + Math.abs(nb - b0);
          // Only blend neighbors that belong to the same color region (preserves sharp outlines)
          if (colorDiff < 32) {
            const weight = colorDiff < 14 ? 1.0 : 0.45;
            rSum += nr * weight;
            gSum += ng * weight;
            bSum += nb * weight;
            wSum += weight;
          }
        }
      }

      out[idx] = Math.round(rSum / wSum);
      out[idx + 1] = Math.round(gSum / wSum);
      out[idx + 2] = Math.round(bSum / wSum);
    }
  }

  imgData.data.set(out);
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Applies Isotropic (8-Connected Diagonal-Friendly) Edge-Preserving Filter
 * Prevents stair-stepping on diagonal lines and eliminates ringing halos.
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

  // Balanced parameters that never over-sharpen or create jagged stair-steps
  let usmAmount = 0.75 * strength;
  let overshootAllowance = 0; // Strict 0 overshoot = zero halo and zero jagged clipping
  let flatThreshold = 3.0;
  let denoiseMix = denoise ? 0.35 : 0;

  if (mode === 'ai-illustration') {
    usmAmount = 0.85 * strength;
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

  // Isotropic Gaussian blur pass (smooths equally in horizontal, vertical, and diagonal directions)
  const temp = new Float32Array(totalPixels);
  const blurLum = new Float32Array(totalPixels);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const xm1 = x > 0 ? x - 1 : x;
      const xp1 = x < width - 1 ? x + 1 : x;
      temp[row + x] = 0.25 * lum[row + xm1] + 0.5 * lum[row + x] + 0.25 * lum[row + xp1];
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
          // Edge area: gentle isotropic unsharp mask strictly clamped to 3x3 local [min, max]
          const lCenter = lum[p];
          const lumDelta = (lCenter - blurLum[p]) * usmAmount;

          const l1 = lum[rowUp + x];
          const l2 = lum[rowDown + x];
          const l3 = lum[row + xm1];
          const l4 = lum[row + xp1];
          const l5 = lum[rowUp + xm1];
          const l6 = lum[rowUp + xp1];
          const l7 = lum[rowDown + xm1];
          const l8 = lum[rowDown + xp1];

          const minL = Math.min(lCenter, l1, l2, l3, l4, l5, l6, l7, l8);
          const maxL = Math.max(lCenter, l1, l2, l3, l4, l5, l6, l7, l8);

          const targetLum = Math.max(
            minL - overshootAllowance,
            Math.min(maxL + overshootAllowance, lCenter + lumDelta)
          );
          const appliedDelta = targetLum - lCenter;

          for (let c = 0; c < 3; c++) {
            out[idx + c] = Math.max(0, Math.min(255, Math.round(src[idx + c] + appliedDelta)));
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
 * Smooth Anti-Aliased Upscaler with Pre-Denoising (No Jagged Stair-Steps)
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

  // Step 1: Clean JPEG mosquito noise and compression smudges at original resolution BEFORE upscaling
  preCleanSourceCanvas(canvas);

  // Step 2: Smooth progressive bicubic upscale (1.5x per pass, WITHOUT intermediate jagged sharpening)
  while (currW < targetW || currH < targetH) {
    const nextW = Math.min(targetW, Math.round(currW * 1.5));
    const nextH = Math.min(targetH, Math.round(currH * 1.5));

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

  // Step 3: Single isotropic edge-restoration pass at target resolution
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

/**
 * Smart 2x2 Grid Splitter & Auto-Centering Cropper
 * Automatically finds the clean gutter between 4 icons/illustrations (or 2x2 photo grid),
 * crops each of the 4 objects, and centers isolated icons on a clean padded canvas.
 */
export async function splitImageIntoQuadrants(sourceUrl, mimeType = 'image/jpeg') {
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

  // Detect background color from corners & mid-borders
  const corners = [
    [2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3],
    [Math.floor(w / 2), 2], [Math.floor(w / 2), h - 3]
  ];
  let bgR = 0, bgG = 0, bgB = 0;
  for (const [cx, cy] of corners) {
    const idx = (Math.max(0, cy) * w + Math.max(0, cx)) * 4;
    bgR += imgData[idx];
    bgG += imgData[idx + 1];
    bgB += imgData[idx + 2];
  }
  bgR = Math.round(bgR / corners.length);
  bgG = Math.round(bgG / corners.length);
  bgB = Math.round(bgB / corners.length);

  const isForeground = (x, y) => {
    const idx = (y * w + x) * 4;
    if (imgData[idx + 3] < 30) return false;
    const diff = Math.abs(imgData[idx] - bgR) + Math.abs(imgData[idx + 1] - bgG) + Math.abs(imgData[idx + 2] - bgB);
    return diff > 36;
  };

  // Find best vertical gutter splitX between 35% and 65% of width
  let splitX = Math.floor(w / 2);
  let minColScore = Infinity;
  const minXSearch = Math.floor(w * 0.35);
  const maxXSearch = Math.floor(w * 0.65);
  for (let x = minXSearch; x <= maxXSearch; x++) {
    let fgCount = 0;
    for (let y = 0; y < h; y += 2) {
      if (isForeground(x, y)) fgCount++;
    }
    const centerBias = Math.abs(x - w / 2) * 0.05;
    const score = fgCount + centerBias;
    if (score < minColScore) {
      minColScore = score;
      splitX = x;
    }
  }

  // Find best horizontal gutter splitY between 35% and 65% of height
  let splitY = Math.floor(h / 2);
  let minRowScore = Infinity;
  const minYSearch = Math.floor(h * 0.35);
  const maxYSearch = Math.floor(h * 0.65);
  for (let y = minYSearch; y <= maxYSearch; y++) {
    let fgCount = 0;
    for (let x = 0; x < w; x += 2) {
      if (isForeground(x, y)) fgCount++;
    }
    const centerBias = Math.abs(y - h / 2) * 0.05;
    const score = fgCount + centerBias;
    if (score < minRowScore) {
      minRowScore = score;
      splitY = y;
    }
  }

  const quads = [
    { x0: 0, y0: 0, x1: splitX, y1: splitY },
    { x0: splitX, y0: 0, x1: w, y1: splitY },
    { x0: 0, y0: splitY, x1: splitX, y1: h },
    { x0: splitX, y0: splitY, x1: w, y1: h }
  ];

  const results = [];
  const isLightBg = bgR > 235 && bgG > 235 && bgB > 235;

  for (let i = 0; i < quads.length; i++) {
    const q = quads[i];
    const qw = q.x1 - q.x0;
    const qh = q.y1 - q.y0;

    // Detect tight bounding box of foreground object inside this quadrant
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
    const hasIsolatedObject = fgPixels > 100 && (maxX > minX) && (maxY > minY) && ((maxX - minX) < qw * 0.96 || (maxY - minY) < qh * 0.96);

    if (hasIsolatedObject) {
      // Center the detected icon/object cleanly with 14% breathing room padding
      const objW = maxX - minX + 1;
      const objH = maxY - minY + 1;
      const side = Math.round(Math.max(objW, objH) * 1.28);
      outCanvas.width = Math.max(side, qw);
      outCanvas.height = Math.max(side, qh);

      const outCtx = outCanvas.getContext('2d');
      outCtx.fillStyle = isLightBg ? '#FFFFFF' : `rgb(${bgR}, ${bgG}, ${bgB})`;
      outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);

      const dstX = Math.round((outCanvas.width - objW) / 2);
      const dstY = Math.round((outCanvas.height - objH) / 2);
      outCtx.drawImage(srcCanvas, minX, minY, objW, objH, dstX, dstY, objW, objH);
    } else {
      // Full quadrant crop
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
      blob,
      url: URL.createObjectURL(blob),
      width: outCanvas.width,
      height: outCanvas.height
    });
  }

  return results;
}

