/**
 * Hybrid Potrace + ImageTracerJS + Schneider Fit-Curve Vectorizer (.SVG & .EPS)
 * Powered by Web Worker engine (vector-worker.js) with:
 * - Automatic engine selection (Color Logo / Two-Tone / Illustration / Pixel Art)
 * - Sub-pixel contour measurement & shared boundary junction locking
 * - Geometric primitive recognition (circles, ellipses, rounded rects, polygons)
 * - Self-repair defect scanner (OffscreenCanvas raster comparison & Potrace patching)
 * - OKLab perceptual color unification & 16 MP Adobe Stock Microstock artboard scaling
 */

import { loadImageElement } from './upscaler.js';
import { escapeXml } from './xmp-exporter.js';

const STOCK_AREA = 16e6; // 16 MP standard for Adobe Stock Vector (15–65 MP requirement)
const WORKER_SCRIPT_URL = new URL('./vector-worker.js', import.meta.url);

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
      ? 'Gambar ini memiliki gradasi fotorealistis kompleks. Untuk Adobe Stock, disarankan di-upload sebagai JPG High-Res (8MP–16MP) agar tidak ditolak karena "Auto-traced Bitmap".'
      : 'Gambar memiliki kontur & bidang warna tegas yang sangat cocok untuk dikonversi menjadi Vector (.SVG / .EPS).'
  };
}

/**
 * Computes 16 MP Adobe Stock artboard dimensions while preserving aspect ratio & viewBox
 */
function stockDims(svg, unit = 1) {
  const tag = (svg.match(/<svg\b[^>]*>/) || [''])[0];
  const get = k => {
    const m = tag.match(new RegExp('\\s' + k + '="([\\d.]+)'));
    return m ? +m[1] : 0;
  };
  let w = get('width');
  let h = get('height');
  if (!(w > 0 && h > 0)) {
    const vb = ((tag.match(/viewBox="([^"]*)"/) || ['', ''])[1]).trim().split(/[\s,]+/).map(Number);
    w = vb[2];
    h = vb[3];
  }
  if (!(w > 0 && h > 0)) return null;
  const a = w * h * unit * unit;
  if (a >= 15.5e6 && a <= 64e6) return { w, h, same: true, ow: w, oh: h };
  const k = Math.sqrt(STOCK_AREA / a);
  const fit = v => Math.ceil(v * unit * k) / unit;
  return { w: fit(w), h: fit(h), same: false, ow: w, oh: h };
}

function stockSVG(svg, unit = 1) {
  const d = stockDims(svg, unit);
  if (!d || d.same) return svg;
  return svg.replace(/<svg\b[^>]*>/, tag => {
    let t = tag.replace(/\swidth="[^"]*"/, '').replace(/\sheight="[^"]*"/, '');
    if (!/\sviewBox=/.test(t)) {
      t = t.replace(/^<svg\b/, `<svg viewBox="0 0 ${d.ow} ${d.oh}"`);
    }
    const f = v => String(+v.toFixed(4));
    return t.replace(/^<svg\b/, `<svg width="${f(d.w)}" height="${f(d.h)}"`);
  });
}

/**
 * Injects Dublin Core RDF metadata (<title>, <desc>, <dc:subject>) into the SVG root
 */
function injectSvgMetadata(svg, metadata = {}) {
  const safeTitle = escapeXml(metadata.title || 'Commercial Vector Illustration Asset');
  const safeDesc = escapeXml(metadata.description || safeTitle);
  const safeKeywords = escapeXml((metadata.keywords || []).join(', '));

  const metaBlock = `<title>${safeTitle}</title><desc>${safeDesc}</desc><metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Description><dc:title>${safeTitle}</dc:title><dc:description>${safeDesc}</dc:description><dc:subject>${safeKeywords}</dc:subject></rdf:Description></rdf:RDF></metadata>`;

  return svg.replace(/<svg\b[^>]*>/, match => `${match}${metaBlock}`);
}

/**
 * PostScript Level 3 EPS Exporter (supports solid fills, evenodd/nonzero, and linear/radial gradients via shfill)
 */
const epsNum = v => String(Math.round(v * 10000) / 10000);

function psRGB(c) {
  if (!c) return null;
  const s = String(c).trim().toLowerCase();
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [m[1], m[2], m[3]].map(v => Math.min(255, +v) / 255);
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255);
  }
  if (s === 'white') return [1, 1, 1];
  if (s === 'black') return [0, 0, 0];
  return null;
}

function svgPathSegs(d) {
  const toks = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const out = [];
  const need = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 };
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, rc = null;

  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) { i++; continue; }
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    if (up === 'Z') {
      out.push({ c: 'Z' });
      x = sx; y = sy; rc = null; cmd = '';
      continue;
    }
    const n = need[up];
    if (!n) { i++; continue; }
    if (i + n > toks.length) break;
    const a = [];
    let bad = false;
    for (let k = 0; k < n; k++) {
      const t = toks[i + k];
      if (/^[A-Za-z]$/.test(t)) { bad = true; break; }
      a.push(+t);
    }
    if (bad) break;
    i += n;
    const ox = rel ? x : 0, oy = rel ? y : 0;
    let nx = x, ny = y, nrc = null;
    if (up === 'M') {
      nx = a[0] + ox; ny = a[1] + oy;
      out.push({ c: 'M', p: [nx, ny] });
      sx = nx; sy = ny;
      cmd = rel ? 'l' : 'L';
    } else if (up === 'L' || up === 'T') {
      nx = a[0] + ox; ny = a[1] + oy;
      out.push({ c: 'L', p: [nx, ny] });
    } else if (up === 'H') {
      nx = a[0] + ox;
      out.push({ c: 'L', p: [nx, y] });
    } else if (up === 'V') {
      ny = a[0] + oy;
      out.push({ c: 'L', p: [x, ny] });
    } else if (up === 'C' || up === 'S') {
      let c1x = x, c1y = y;
      if (up === 'C') { c1x = a[0] + ox; c1y = a[1] + oy; }
      else if (rc) { c1x = 2 * x - rc[0]; c1y = 2 * y - rc[1]; }
      const j = up === 'C' ? 2 : 0;
      const c2x = a[j] + ox, c2y = a[j + 1] + oy;
      nx = a[j + 2] + ox; ny = a[j + 3] + oy;
      out.push({ c: 'C', p: [c1x, c1y, c2x, c2y, nx, ny] });
      nrc = [c2x, c2y];
    } else if (up === 'Q') {
      const qx = a[0] + ox, qy = a[1] + oy;
      nx = a[2] + ox; ny = a[3] + oy;
      out.push({
        c: 'C',
        p: [
          x + (2 / 3) * (qx - x),
          y + (2 / 3) * (qy - y),
          nx + (2 / 3) * (qx - nx),
          ny + (2 / 3) * (qy - ny),
          nx,
          ny
        ]
      });
    } else if (up === 'A') {
      nx = a[5] + ox; ny = a[6] + oy;
      out.push({ c: 'L', p: [nx, ny] });
    }
    x = nx; y = ny; rc = nrc;
  }
  return out;
}

function psOps(segs) {
  const o = [];
  for (const s of segs) {
    if (s.c === 'Z') o.push('closepath');
    else o.push(s.p.map(epsNum).join(' ') + ' ' + ({ M: 'moveto', L: 'lineto', C: 'curveto' })[s.c]);
  }
  return o.join('\n');
}

function segsBBox(segs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of segs) {
    if (s.p) {
      for (let k = 0; k < s.p.length; k += 2) {
        x0 = Math.min(x0, s.p[k]);
        x1 = Math.max(x1, s.p[k]);
        y0 = Math.min(y0, s.p[k + 1]);
        y1 = Math.max(y1, s.p[k + 1]);
      }
    }
  }
  return isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function svgGradientStops(g) {
  const stops = [];
  let last = 0;
  for (const s of g.querySelectorAll('stop')) {
    const st = /stop-color:\s*([^;]+)/.exec(s.getAttribute('style') || '');
    const col = psRGB(s.getAttribute('stop-color') || (st && st[1].trim())) || [0, 0, 0];
    const ov = (s.getAttribute('offset') || '0').trim();
    let o = parseFloat(ov);
    if (!isFinite(o)) o = 0;
    if (/%$/.test(ov)) o /= 100;
    o = Math.min(1, Math.max(0, o));
    if (o < last) o = last;
    last = o;
    stops.push({ o, c: col });
  }
  return stops;
}

function psFunction(stops) {
  const st = stops.map(s => ({ o: s.o, c: s.c }));
  for (let i = 1; i < st.length; i++) {
    if (st[i].o <= st[i - 1].o) st[i].o = Math.min(1, st[i - 1].o + 1e-4);
  }
  const fn = (a, b) => '<< /FunctionType 2 /Domain [0 1] /C0 [' + a.map(epsNum).join(' ') + '] /C1 [' + b.map(epsNum).join(' ') + '] /N 1 >>';
  if (st.length === 1) return fn(st[0].c, st[0].c);
  if (st.length === 2) return fn(st[0].c, st[1].c);
  const fns = [];
  for (let i = 0; i < st.length - 1; i++) fns.push(fn(st[i].c, st[i + 1].c));
  return '<< /FunctionType 3 /Domain [0 1] /Functions [' + fns.join(' ') + '] /Bounds [' + st.slice(1, -1).map(s => epsNum(s.o)).join(' ') + '] /Encode [' + st.slice(0, -1).map(() => '0 1').join(' ') + '] >>';
}

function gradientPS(g, bb, vb) {
  const stops = svgGradientStops(g);
  if (!stops.length) return null;
  const last = stops[stops.length - 1].c;
  const pre = [];
  const bbox = (g.getAttribute('gradientUnits') || 'objectBoundingBox').trim() !== 'userSpaceOnUse';
  const C = (attr, def, axis) => {
    const s = (g.getAttribute(attr) || def).trim();
    const n = parseFloat(s);
    if (!isFinite(n)) return 0;
    if (!/%$/.test(s)) return n;
    const f = n / 100;
    if (bbox) return f;
    return f * (axis === 'x' ? vb[2] : axis === 'y' ? vb[3] : Math.hypot(vb[2], vb[3]) / Math.SQRT2);
  };
  if (bbox) {
    if (!bb || bb.w <= 0 || bb.h <= 0) return { solid: last };
    pre.push('[' + [bb.w, 0, 0, bb.h, bb.x, bb.y].map(epsNum).join(' ') + '] concat');
  }
  let type, coords;
  if (g.tagName !== 'radialGradient') {
    const x1 = C('x1', '0%', 'x'), y1 = C('y1', '0%', 'y'), x2 = C('x2', '100%', 'x'), y2 = C('y2', '0%', 'y');
    if (x1 === x2 && y1 === y2) return { solid: last };
    type = 2;
    coords = [x1, y1, x2, y2];
  } else {
    const cx = C('cx', '50%', 'x'), cy = C('cy', '50%', 'y'), r = C('r', '50%', 'r');
    if (!(r > 0)) return { solid: last };
    const fx = g.hasAttribute('fx') ? C('fx', '50%', 'x') : cx;
    const fy = g.hasAttribute('fy') ? C('fy', '50%', 'y') : cy;
    type = 3;
    coords = [fx, fy, 0, cx, cy, r];
  }
  const gt = (g.getAttribute('gradientTransform') || '').match(/matrix\(([^)]*)\)/);
  if (gt) {
    const m = gt[1].split(/[\s,]+/).filter(Boolean).map(Number);
    if (m.length === 6 && m.every(isFinite)) pre.push('[' + m.map(epsNum).join(' ') + '] concat');
  }
  return {
    pre,
    dict: '<< /ShadingType ' + type + ' /ColorSpace /DeviceRGB /Coords [' + coords.map(epsNum).join(' ') + '] /Function ' + psFunction(stops) + ' /Extend [true true] >>'
  };
}

export function svgToEPS(svg, title = 'Commercial Vector Asset', keywords = '') {
  const doc = new DOMParser().parseFromString(String(svg), 'image/svg+xml');
  const root = doc.documentElement;
  const numAttr = v => {
    const n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : 0;
  };
  let vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !(vb[2] > 0 && vb[3] > 0)) {
    vb = [0, 0, numAttr(root.getAttribute('width')) || 1, numAttr(root.getAttribute('height')) || 1];
  }
  const wPx = numAttr(root.getAttribute('width')) || vb[2];
  const k = (wPx * 0.75) / vb[2];
  const W = vb[2] * k;
  const H = vb[3] * k;

  const out = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%Creator: Microstock Adobe Helper Pro - Hybrid Potrace & Schneider Vector Engine',
    '%%Title: ' + String(title || 'vector').replace(/[()\\\r\n]/g, '_'),
    '%%Keywords: ' + String(keywords || '').replace(/[()\\\r\n]/g, ' '),
    '%%BoundingBox: 0 0 ' + Math.ceil(W) + ' ' + Math.ceil(H),
    '%%HiResBoundingBox: 0 0 ' + epsNum(W) + ' ' + epsNum(H),
    '%%LanguageLevel: 3',
    '%%EndComments',
    'gsave',
    '[' + [k, 0, 0, -k, -vb[0] * k, H + vb[1] * k].map(epsNum).join(' ') + '] concat'
  ];

  for (const p of doc.querySelectorAll('path')) {
    const d = p.getAttribute('d');
    if (!d) continue;
    const fill = (p.getAttribute('fill') || ((/fill:\s*([^;]+)/.exec(p.getAttribute('style') || '')) || [])[1] || 'black').trim();
    if (fill === 'none') continue;
    const segs = svgPathSegs(d);
    if (!segs.length) continue;
    const eo = (p.getAttribute('fill-rule') || 'nonzero').trim() === 'evenodd';
    const ops = psOps(segs);
    const paint = eo ? 'eofill' : 'fill';
    const clip = eo ? 'eoclip' : 'clip';
    const ref = /^url\(#([^)]+)\)$/.exec(fill);
    let col = ref ? null : psRGB(fill);
    if (ref) {
      const g = doc.getElementById(ref[1].replace(/['"]/g, ''));
      const gp = g && /Gradient$/.test(g.tagName) ? gradientPS(g, segsBBox(segs), vb) : null;
      if (gp && gp.dict) {
        out.push('gsave', 'newpath', ops, clip, 'newpath', ...gp.pre, gp.dict, 'shfill', 'grestore');
        continue;
      }
      col = (gp && gp.solid) || [0, 0, 0];
    }
    if (!col) col = [0, 0, 0];
    out.push('gsave', col.map(epsNum).join(' ') + ' setrgbcolor', 'newpath', ops, paint, 'grestore');
  }

  out.push('grestore', 'showpage', '%%EOF');
  return out.join('\n') + '\n';
}

/**
 * Runs the Web Worker Vectorizer Engine (Potrace + ImageTracerJS + fit-curve + Self-Repair)
 */
function runVectorWorker(imageData, origW, origH, settings, onProgress) {
  return new Promise((resolve, reject) => {
    let worker = null;
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      if (worker) {
        try { worker.terminate(); } catch (e) {}
        worker = null;
      }
      if (err) reject(err);
      else resolve(result);
    };

    try {
      worker = new Worker(WORKER_SCRIPT_URL);
    } catch (err) {
      return finish(new Error('Gagal memulai Web Worker Vectorizer: ' + err.message));
    }

    worker.onerror = e => {
      finish(new Error(e.message || 'Gagal memproses di Web Worker Vectorizer.'));
    };

    worker.onmessage = ({ data: m }) => {
      if (!m) return;
      if (m.phase) {
        if (typeof onProgress === 'function') onProgress(m.phase, m.stage);
        return;
      }
      if (m.error) {
        return finish(new Error(m.error));
      }
      if (!m.svg || !/<path/.test(m.svg)) {
        return finish(new Error('Tidak ada kurva vektor yang terbentuk dari gambar ini.'));
      }
      finish(null, m);
    };

    const bufferCopy = new Uint8ClampedArray(imageData.data).buffer;
    worker.postMessage(
      {
        buffer: bufferCopy,
        width: imageData.width,
        height: imageData.height,
        originalWidth: origW,
        originalHeight: origH,
        settings
      },
      [bufferCopy]
    );
  });
}

/**
 * Main Vectorizer Entry Point: Converts image into smooth Bezier .SVG & .EPS
 */
export async function convertImageToVector(sourceUrl, options = {}) {
  const numColors = Math.min(24, Math.max(2, options.colors || 16));
  const minSpeckleArea = options.minSpeckleArea ?? 12;
  const metadata = options.metadata || {};
  const maxWorkDim = options.maxResolution || 1000;

  const img = typeof sourceUrl === 'string' ? await loadImageElement(sourceUrl) : sourceUrl;
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;

  const ratio = Math.min(1, maxWorkDim / Math.max(origW, origH));
  const workW = Math.max(1, Math.round(origW * ratio));
  const workH = Math.max(1, Math.round(origH * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = workW;
  canvas.height = workH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, workW, workH);

  const imageData = ctx.getImageData(0, 0, workW, workH);
  const suitability = evaluateVectorSuitability(imageData, workW, workH);

  const workerSettings = {
    mode: options.mode || 'auto',
    removeBackground: !!options.removeBackground,
    texture: 'clean',
    quality: 'accurate',
    geometry: options.geometry !== false,
    seams: options.seams !== false,
    detail: options.detail !== false,
    preprocess: 'auto',
    colors: numColors,
    threshold: 128,
    smooth: options.smooth ?? 2,
    clean: options.clean ?? 2,
    noise: minSpeckleArea,
    removeWhite: false,
    whiteLevel: 250,
    corners: options.corners !== false
  };

  const workerResult = await runVectorWorker(
    imageData,
    origW,
    origH,
    workerSettings,
    options.onProgress
  );

  // Scale SVG artboard to 16 MP Adobe Stock standard & embed Dublin Core RDF metadata
  const rawSvg = workerResult.svg;
  const scaledSvg = stockSVG(rawSvg, 1);
  const svgString = injectSvgMetadata(scaledSvg, metadata);

  // Convert 16 MP scaled SVG to PostScript Level 3 EPS
  const safeTitle = metadata.title || 'Commercial Vector Illustration Asset';
  const safeKeywords = (metadata.keywords || []).join(', ');
  const epsString = svgToEPS(stockSVG(rawSvg, 0.75), safeTitle, safeKeywords);

  const pathCount = (svgString.match(/<path\b/g) || []).length;
  const fillMatches = svgString.match(/\bfill="([^"]+)"/g) || [];
  const colorCount = new Set(fillMatches.filter(f => !f.includes('none'))).size || 1;

  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
  const epsBlob = new Blob([epsString], { type: 'application/postscript' });

  return {
    svgString,
    epsString,
    svgBlob,
    epsBlob,
    svgUrl: URL.createObjectURL(svgBlob),
    epsUrl: URL.createObjectURL(epsBlob),
    pathCount,
    colorCount,
    engine: workerResult.engine || 'Hybrid Potrace',
    defects: workerResult.defects || null,
    suitability
  };
}
