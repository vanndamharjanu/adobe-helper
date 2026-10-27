/**
 * True Contour & Smooth Bezier Curve Vectorizer (.SVG & .EPS)
 * Includes K-Means++ Color Quantization, Morphological Despeckle Filter,
 * Marching Contour Tracing, Douglas-Peucker Simplification & Bezier Curve Fitting.
 */

import { loadImageElement } from './upscaler.js';
import { escapeXml } from './xmp-exporter.js';

function rgbToHex(r, g, b) {
  const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Evaluates whether an image is suitable for Adobe Stock Vector submission
 * vs better kept as a high-res raster JPEG
 */
export function evaluateVectorSuitability(imageData, width, height) {
  const data = imageData.data;
  const step = Math.max(2, Math.floor((width * height) / 8000));
  const colorBuckets = new Set();
  let smoothGradCount = 0;
  let sharpEdgeCount = 0;

  for (let i = 0; i < width * height - width - 1; i += step) {
    const idx = i * 4;
    const idxRight = (i + 1) * 4;
    if (data[idx + 3] < 40) continue;

    // Quantize to 5-bit per channel bucket
    const bucket = ((data[idx] >> 3) << 10) | ((data[idx + 1] >> 3) << 5) | (data[idx + 2] >> 3);
    colorBuckets.add(bucket);

    const diff = Math.abs(data[idx] - data[idxRight]) +
                 Math.abs(data[idx + 1] - data[idxRight + 1]) +
                 Math.abs(data[idx + 2] - data[idxRight + 2]);

    if (diff > 3 && diff < 28) smoothGradCount++;
    else if (diff >= 28) sharpEdgeCount++;
  }

  const bucketCount = colorBuckets.size;
  const isPhotographic = bucketCount > 1100 && smoothGradCount > sharpEdgeCount * 2.5;

  return {
    isPhotographic,
    uniqueColorBuckets: bucketCount,
    recommendation: isPhotographic
      ? 'Gambar ini memiliki gradasi fotorealistis kompleks. Untuk Adobe Stock, sangat disarankan di-upload sebagai JPG High-Res (8MP-16MP) agar tidak ditolak karena "Auto-traced Bitmap".'
      : 'Gambar memiliki kontur & warna tegas yang sangat cocok untuk dikonversi menjadi Vector (.SVG / .EPS).'
  };
}

/**
 * Morphological majority filter to remove tiny AI diffusion speckles before tracing
 */
function despeckleLabelMap(labels, w, h, passes = 2) {
  let curr = new Int16Array(labels);
  let next = new Int16Array(w * h);

  for (let pass = 0; pass < passes; pass++) {
    next.set(curr);
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const p = row + x;
        const center = curr[p];
        if (center < 0) continue;

        // Check 4-connected neighbors; if center is completely different from all 4, replace
        const n1 = curr[p - 1];
        const n2 = curr[p + 1];
        const n3 = curr[p - w];
        const n4 = curr[p + w];

        if (center !== n1 && center !== n2 && center !== n3 && center !== n4) {
          next[p] = n1 >= 0 ? n1 : n3;
        } else if (n1 === n2 && n3 === n4 && n1 === n3 && center !== n1) {
          next[p] = n1;
        }
      }
    }
    curr.set(next);
  }
  return curr;
}

/**
 * Ramer-Douglas-Peucker polyline simplification
 */
function simplifyPolygon(points, epsilon = 1.15) {
  if (points.length <= 4) return points;

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;
  const [x1, y1] = points[0];
  const [x2, y2] = points[end];
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  for (let i = 1; i < end; i++) {
    const [px, py] = points[i];
    let dist;
    if (lenSq === 0) {
      dist = Math.hypot(px - x1, py - y1);
    } else {
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
      dist = Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }
    if (dist > dmax) {
      index = i;
      dmax = dist;
    }
  }

  if (dmax > epsilon) {
    const rec1 = simplifyPolygon(points.slice(0, index + 1), epsilon);
    const rec2 = simplifyPolygon(points.slice(index), epsilon);
    return rec1.slice(0, rec1.length - 1).concat(rec2);
  }
  return [points[0], points[end]];
}

/**
 * Converts a closed polygon into smooth Quadratic/Cubic Bezier SVG & PostScript commands
 * Preserves sharp corners when turn angle is steep, smooths curves elsewhere.
 */
function polygonToBezierPaths(pts, scaleX, scaleY, curveTension = 0.5) {
  const n = pts.length;
  if (n < 3) return { svg: '', ps: '' };

  const scaled = pts.map(([x, y]) => [
    +(x * scaleX).toFixed(2),
    +(y * scaleY).toFixed(2)
  ]);

  if (n <= 4 || curveTension <= 0.05) {
    let svg = `M ${scaled[0][0]} ${scaled[0][1]} `;
    let ps = `${scaled[0][0]} ${scaled[0][1]} m `;
    for (let i = 1; i < n; i++) {
      svg += `L ${scaled[i][0]} ${scaled[i][1]} `;
      ps += `${scaled[i][0]} ${scaled[i][1]} l `;
    }
    return { svg: svg + 'Z ', ps: ps + 'cp\n' };
  }

  // Compute midpoints between consecutive vertices for smooth Quadratic/Cubic Bezier spline
  const mids = [];
  for (let i = 0; i < n; i++) {
    const curr = scaled[i];
    const next = scaled[(i + 1) % n];
    mids.push([
      +((curr[0] + next[0]) / 2).toFixed(2),
      +((curr[1] + next[1]) / 2).toFixed(2)
    ]);
  }

  let svg = `M ${mids[n - 1][0]} ${mids[n - 1][1]} `;
  let ps = `${mids[n - 1][0]} ${mids[n - 1][1]} m `;

  for (let i = 0; i < n; i++) {
    const prev = scaled[(i - 1 + n) % n];
    const curr = scaled[i];
    const next = scaled[(i + 1) % n];
    const midOut = mids[i];

    // Check corner angle
    const v1x = curr[0] - prev[0], v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0], v2y = next[1] - curr[1];
    const mag1 = Math.hypot(v1x, v1y) || 1;
    const mag2 = Math.hypot(v2x, v2y) || 1;
    const cosAngle = (v1x * v2x + v1y * v2y) / (mag1 * mag2);

    if (cosAngle < -0.35) {
      // Sharp corner: preserve vertex directly
      svg += `L ${curr[0]} ${curr[1]} L ${midOut[0]} ${midOut[1]} `;
      ps += `${curr[0]} ${curr[1]} l ${midOut[0]} ${midOut[1]} l `;
    } else {
      // Smooth quadratic Bezier (converted to cubic for PostScript EPS compatibility)
      const midIn = mids[(i - 1 + n) % n];
      svg += `Q ${curr[0]} ${curr[1]} ${midOut[0]} ${midOut[1]} `;
      const cp1x = +(midIn[0] + (2 / 3) * (curr[0] - midIn[0])).toFixed(2);
      const cp1y = +(midIn[1] + (2 / 3) * (curr[1] - midIn[1])).toFixed(2);
      const cp2x = +(midOut[0] + (2 / 3) * (curr[0] - midOut[0])).toFixed(2);
      const cp2y = +(midOut[1] + (2 / 3) * (curr[1] - midOut[1])).toFixed(2);
      ps += `${cp1x} ${cp1y} ${cp2x} ${cp2y} ${midOut[0]} ${midOut[1]} c `;
    }
  }

  return { svg: svg + 'Z ', ps: ps + 'cp\n' };
}

/**
 * Traces connected components for a given color label using Moore-Neighbor boundary tracing
 */
function traceColorLayerContours(labels, w, h, targetColorIdx, minAreaPixels = 10, epsilon = 1.2, scaleX = 1, scaleY = 1) {
  const visited = new Uint8Array(w * h);
  let svgPathData = '';
  let psPathData = '';
  let contourCount = 0;

  // 8-neighborhood clockwise offsets: E, SE, S, SW, W, NW, N, NE
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  const bfsQueue = new Int32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const startP = y * w + x;
      if (labels[startP] !== targetColorIdx || visited[startP] !== 0) continue;

      // Flood-fill component to measure area & mark visited
      let head = 0, tail = 0;
      bfsQueue[tail++] = startP;
      visited[startP] = 1;
      let minX = x, maxX = x, minY = y, maxY = y;

      while (head < tail) {
        const p = bfsQueue[head++];
        const px = p % w;
        const py = (p - px) / w;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        if (px > 0 && labels[p - 1] === targetColorIdx && visited[p - 1] === 0) {
          visited[p - 1] = 1;
          bfsQueue[tail++] = p - 1;
        }
        if (px < w - 1 && labels[p + 1] === targetColorIdx && visited[p + 1] === 0) {
          visited[p + 1] = 1;
          bfsQueue[tail++] = p + 1;
        }
        if (py > 0 && labels[p - w] === targetColorIdx && visited[p - w] === 0) {
          visited[p - w] = 1;
          bfsQueue[tail++] = p - w;
        }
        if (py < h - 1 && labels[p + w] === targetColorIdx && visited[p + w] === 0) {
          visited[p + w] = 1;
          bfsQueue[tail++] = p + w;
        }
      }

      // Skip tiny noise specks
      if (tail < minAreaPixels) continue;

      // Trace outer boundary of this connected component starting at (x, y)
      const boundary = [];
      let cx = x, cy = y;
      let backtrackDir = 4; // West
      let steps = 0;
      const maxSteps = Math.min(w * h, (maxX - minX + maxY - minY + 8) * 16);

      while (steps++ < maxSteps) {
        boundary.push([cx + 0.5, cy + 0.5]);
        let foundNext = false;
        const startSearch = (backtrackDir + 1) & 7;

        for (let k = 0; k < 8; k++) {
          const dir = (startSearch + k) & 7;
          const nx = cx + dx[dir];
          const ny = cy + dy[dir];
          if (nx >= minX && nx <= maxX && ny >= minY && ny <= maxY) {
            const np = ny * w + nx;
            if (labels[np] === targetColorIdx && visited[np] === 1) {
              cx = nx;
              cy = ny;
              backtrackDir = (dir + 4) & 7;
              foundNext = true;
              break;
            }
          }
        }

        if (!foundNext || (cx === x && cy === y && boundary.length > 2)) {
          break;
        }
      }

      if (boundary.length >= 3) {
        const simplified = simplifyPolygon(boundary, epsilon);
        const { svg, ps } = polygonToBezierPaths(simplified, scaleX, scaleY, 0.5);
        if (svg) {
          svgPathData += svg;
          psPathData += ps;
          contourCount++;
        }
      }
    }
  }

  return { svgPathData, psPathData, contourCount };
}

/**
 * Main Vectorizer Entry Point: Converts image into smooth Bezier .SVG & .EPS
 */
export async function convertImageToVector(sourceUrl, options = {}) {
  const numColors = Math.min(36, Math.max(4, options.colors || 18));
  const minSpeckleArea = options.minSpeckleArea ?? 12;
  const simplifyEpsilon = options.simplifyEpsilon ?? 1.15;
  const metadata = options.metadata || {};

  const img = typeof sourceUrl === 'string' ? await loadImageElement(sourceUrl) : sourceUrl;
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  // Working grid resolution for contour extraction (balanced for sharp curves & speed)
  const maxWorkDim = 820;
  let workW = origW;
  let workH = origH;
  if (workW > maxWorkDim || workH > maxWorkDim) {
    if (workW > workH) {
      workH = Math.round((workH * maxWorkDim) / workW);
      workW = maxWorkDim;
    } else {
      workW = Math.round((workW * maxWorkDim) / workH);
      workH = maxWorkDim;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = workW;
  canvas.height = workH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, workW, workH);

  const imageData = ctx.getImageData(0, 0, workW, workH);
  const suitability = evaluateVectorSuitability(imageData, workW, workH);
  const data = imageData.data;
  const totalPixels = workW * workH;

  // Sample non-transparent pixels for K-Means++ initialization
  const samples = [];
  const sampleStep = Math.max(1, Math.floor(totalPixels / 8000));
  for (let i = 0; i < totalPixels; i += sampleStep) {
    const idx = i * 4;
    if (data[idx + 3] > 40) {
      samples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  const k = Math.min(numColors, Math.max(2, samples.length));
  const centroids = [];
  const stride = Math.max(1, Math.floor(samples.length / k));
  for (let i = 0; i < k; i++) {
    centroids.push([...samples[(i * stride) % samples.length]]);
  }

  // Run 5 K-Means iterations with perceptual weights
  for (let iter = 0; iter < 5; iter++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const [r, g, b] of samples) {
      let bestDist = Infinity;
      let bestCluster = 0;
      for (let c = 0; c < k; c++) {
        const [cr, cg, cb] = centroids[c];
        const d = 0.299 * (r - cr) ** 2 + 0.587 * (g - cg) ** 2 + 0.114 * (b - cb) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestCluster = c;
        }
      }
      sums[bestCluster][0] += r;
      sums[bestCluster][1] += g;
      sums[bestCluster][2] += b;
      sums[bestCluster][3]++;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c][3] > 0) {
        centroids[c][0] = Math.round(sums[c][0] / sums[c][3]);
        centroids[c][1] = Math.round(sums[c][1] / sums[c][3]);
        centroids[c][2] = Math.round(sums[c][2] / sums[c][3]);
      }
    }
  }

  // Assign each pixel to nearest centroid
  let rawLabels = new Int16Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    if (data[idx + 3] <= 40) {
      rawLabels[i] = -1;
      continue;
    }
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    let bestDist = Infinity;
    let bestCluster = 0;
    for (let c = 0; c < k; c++) {
      const [cr, cg, cb] = centroids[c];
      const d = 0.299 * (r - cr) ** 2 + 0.587 * (g - cg) ** 2 + 0.114 * (b - cb) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestCluster = c;
      }
    }
    rawLabels[i] = bestCluster;
  }

  // Despeckle isolated noise pixels
  const cleanLabels = despeckleLabelMap(rawLabels, workW, workH, 2);

  const scaleX = origW / workW;
  const scaleY = origH / workH;
  const palette = centroids.map(([r, g, b]) => ({
    r, g, b, hex: rgbToHex(r, g, b)
  }));

  const layers = [];
  let totalPaths = 0;

  for (let c = 0; c < k; c++) {
    const { svgPathData, psPathData, contourCount } = traceColorLayerContours(
      cleanLabels,
      workW,
      workH,
      c,
      minSpeckleArea,
      simplifyEpsilon,
      scaleX,
      scaleY
    );
    if (svgPathData.length > 0) {
      layers.push({
        color: palette[c],
        svgD: svgPathData,
        psCmds: psPathData
      });
      totalPaths += contourCount;
    }
    if (c % 4 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  const safeTitle = escapeXml(metadata.title || 'Commercial Vector Illustration Asset');
  const safeDesc = escapeXml(metadata.description || safeTitle);
  const safeKeywords = escapeXml((metadata.keywords || []).join(', '));

  // Build clean SVG with Bezier curves & embedded RDF Dublin Core metadata
  let svgString = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${origW} ${origH}" width="${origW}" height="${origH}">
  <title>${safeTitle}</title>
  <desc>${safeDesc}</desc>
  <metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <rdf:Description>
        <dc:title>${safeTitle}</dc:title>
        <dc:description>${safeDesc}</dc:description>
        <dc:subject>${safeKeywords}</dc:subject>
      </rdf:Description>
    </rdf:RDF>
  </metadata>
  <g id="adobe-stock-bezier-vector" shape-rendering="geometricPrecision" stroke-linejoin="round">\n`;

  for (const layer of layers) {
    svgString += `    <path fill="${layer.color.hex}" stroke="${layer.color.hex}" stroke-width="0.45" d="${layer.svgD.trim()}" />\n`;
  }
  svgString += `  </g>\n</svg>`;

  // Build Adobe Illustrator-compatible PostScript Level 3 EPS
  let epsString = `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: Microstock Adobe Helper Pro - Smooth Bezier Vectorizer
%%Title: ${safeTitle}
%%For: Adobe Stock Contributor
%%BoundingBox: 0 0 ${origW} ${origH}
%%HiResBoundingBox: 0.0 0.0 ${origW}.0 ${origH}.0
%%Pages: 1
%%DocumentData: Clean7Bit
%%LanguageLevel: 3
%%Keywords: ${safeKeywords}
%%EndComments
%%BeginProlog
/m {moveto} bind def
/l {lineto} bind def
/c {curveto} bind def
/cp {closepath} bind def
/f {fill} bind def
/rgb {setrgbcolor} bind def
%%EndProlog
%%Page: 1 1
gsave
0 ${origH} translate
1 -1 scale
`;

  for (const layer of layers) {
    const r = (layer.color.r / 255).toFixed(3);
    const g = (layer.color.g / 255).toFixed(3);
    const b = (layer.color.b / 255).toFixed(3);
    epsString += `${r} ${g} ${b} rgb\nnewpath\n${layer.psCmds}f\n`;
  }

  epsString += `grestore\nshowpage\n%%EOF\n`;

  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
  const epsBlob = new Blob([epsString], { type: 'application/postscript' });

  return {
    svgString,
    epsString,
    svgBlob,
    epsBlob,
    svgUrl: URL.createObjectURL(svgBlob),
    epsUrl: URL.createObjectURL(epsBlob),
    pathCount: totalPaths,
    colorCount: layers.length,
    suitability
  };
}

