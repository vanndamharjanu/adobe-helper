/**
 * Hybrid Potrace + ImageTracerJS + Schneider Fit-Curve Vectorizer (.SVG & .EPS)
 * Powered by Web Worker engine (vector-worker.js) with:
 * - Automatic engine selection (Color Logo / Two-Tone / Illustration / Pixel Art)
 * - Sub-pixel contour measurement & shared boundary junction locking
 * - Geometric primitive recognition (circles, ellipses, rounded rects, polygons)
 * - Self-repair defect scanner (OffscreenCanvas raster comparison & Potrace patching)
 * - OKLab perceptual color unification & 16 MP Adobe Stock Microstock artboard scaling
 */

import { loadImageElement } from './upscaler.js?v=20261121_01';
import { escapeXml } from './xmp-exporter.js?v=20261121_01';

const STOCK_AREA = 16e6; // 16 MP standard for Adobe Stock Vector (15–65 MP requirement)
const WORKER_SCRIPT_URL = new URL('./vector-worker.js?v=20261121_01', import.meta.url);

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
 * Injects or updates Dublin Core RDF metadata (<title>, <desc>, <dc:subject>) inside the SVG root idempotently
 */
export function injectSvgMetadata(svg, metadata = {}) {
  const cleanSvg = String(svg || '').replace(
    /(?:<title>[\s\S]*?<\/title>\s*)?(?:<desc>[\s\S]*?<\/desc>\s*)?(?:<metadata>[\s\S]*?<\/metadata>\s*)/i,
    ''
  );
  const safeTitle = escapeXml(metadata.title || 'Commercial Vector Illustration Asset');
  const safeDesc = escapeXml(metadata.description || safeTitle);
  const safeKeywords = escapeXml((metadata.keywords || []).join(', '));

  const metaBlock = `<title>${safeTitle}</title><desc>${safeDesc}</desc><metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Description><dc:title>${safeTitle}</dc:title><dc:description>${safeDesc}</dc:description><dc:subject>${safeKeywords}</dc:subject></rdf:Description></rdf:RDF></metadata>`;

  return cleanSvg.replace(/<svg\b[^>]*>/, match => `${match}${metaBlock}`);
}

/**
 * Updates %%Title and %%Keywords DSC comments in an existing EPS string without re-tracing paths
 */
export function updateEpsMetadata(epsString, metadata = {}) {
  const safeTitle = String(metadata.title || 'Commercial Vector Asset').replace(/[()\\\r\n]/g, '_');
  const kwText = Array.isArray(metadata.keywords) ? metadata.keywords.join(', ') : String(metadata.keywords || '');
  const safeKeywords = kwText.replace(/[()\\\r\n]/g, ' ');
  return String(epsString || '')
    .replace(/^%%Title:.*$/m, () => `%%Title: ${safeTitle}`)
    .replace(/^%%Keywords:.*$/m, () => `%%Keywords: ${safeKeywords}`);
}

/**
 * PostScript Level 3 EPS Exporter
 * Supports: all SVG shapes (<path>, <rect>, <circle>, <ellipse>, <polygon>, <polyline>, <line>),
 * nested <g> inheritance & transforms, elliptical arcs (A -> cubic Bezier), fill + stroke,
 * opacity flattening against white, and linear/radial gradients via shfill.
 */
const epsNum = v => {
  const n = Math.round(v * 10000) / 10000;
  return Object.is(n, -0) ? '0' : String(n);
};

const NAMED_COLORS = {
  white: [1, 1, 1], black: [0, 0, 0], red: [1, 0, 0], green: [0, 128 / 255, 0],
  blue: [0, 0, 1], yellow: [1, 1, 0], cyan: [0, 1, 1], magenta: [1, 0, 1],
  gray: [128 / 255, 128 / 255, 128 / 255], grey: [128 / 255, 128 / 255, 128 / 255],
  silver: [192 / 255, 192 / 255, 192 / 255], orange: [1, 165 / 255, 0],
  purple: [128 / 255, 0, 128 / 255], pink: [1, 192 / 255, 203 / 255],
  brown: [165 / 255, 42 / 255, 42 / 255], navy: [0, 0, 128 / 255], teal: [0, 128 / 255, 128 / 255]
};

function psRGBA(c) {
  if (!c) return null;
  const s = String(c).trim().toLowerCase();
  if (s === 'none' || s === 'transparent') return null;
  let m = /^rgba?\(\s*([\d.]+%?)\s*[\s,]\s*([\d.]+%?)\s*[\s,]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const ch = v => v.endsWith('%') ? Math.max(0, Math.min(1, parseFloat(v) / 100)) : Math.max(0, Math.min(1, parseFloat(v) / 255));
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [ch(m[1]), ch(m[2]), ch(m[3]), Math.max(0, Math.min(1, isFinite(a) ? a : 1))];
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join('');
    const rgb = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255);
    const a = h.length === 8 ? parseInt(h.substr(6, 2), 16) / 255 : 1;
    return [...rgb, a];
  }
  if (NAMED_COLORS[s]) return [...NAMED_COLORS[s], 1];
  return null;
}

function psRGB(c, opacity = 1) {
  const rgba = psRGBA(c);
  if (!rgba) return null;
  const a = Math.max(0, Math.min(1, rgba[3] * opacity));
  if (a <= 0) return null;
  // Flatten semi-transparency onto white #FFFFFF for PostScript compatibility
  return a >= 0.999 ? rgba.slice(0, 3) : rgba.slice(0, 3).map(v => v * a + (1 - a));
}

function mulMat(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

function parseSvgTransform(str) {
  if (!str) return null;
  let m = [1, 0, 0, 1, 0, 0];
  let matched = false;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/gi;
  let tok;
  while ((tok = re.exec(str)) !== null) {
    matched = true;
    const fn = tok[1].toLowerCase();
    const a = tok[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t = [1, 0, 0, 1, 0, 0];
    if (fn === 'matrix' && a.length >= 6) t = a.slice(0, 6);
    else if (fn === 'translate') t = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (fn === 'scale') {
      const sx = a[0] ?? 1;
      t = [sx, 0, 0, a.length > 1 ? a[1] : sx, 0, 0];
    } else if (fn === 'rotate') {
      const rad = ((a[0] || 0) * Math.PI) / 180;
      const co = Math.cos(rad), si = Math.sin(rad);
      if (a.length >= 3) {
        const cx = a[1], cy = a[2];
        t = mulMat(mulMat([1, 0, 0, 1, cx, cy], [co, si, -si, co, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
      } else {
        t = [co, si, -si, co, 0, 0];
      }
    } else if (fn === 'skewx') t = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewy') t = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    if (t.every(isFinite)) m = mulMat(m, t);
  }
  return matched ? m : null;
}

/**
 * Converts SVG elliptical arc (A) into cubic Bezier segments (W3C SVG 1.1 F.6.5/F.6.6)
 */
function svgArcToCubic(x1, y1, rxIn, ryIn, phiDeg, largeArc, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  if (rx < 1e-6 || ry < 1e-6) return [{ c: 'L', p: [x2, y2] }];

  const phi = ((phiDeg % 360) * Math.PI) / 180;
  const co = Math.cos(phi), si = Math.sin(phi);
  const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
  const x1p = co * dx2 + si * dy2;
  const y1p = -si * dx2 + co * dy2;

  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx, ry2 = ry * ry, x1p2 = x1p * x1p, y1p2 = y1p * y1p;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
  const den = rx2 * y1p2 + ry2 * x1p2;
  const fac = (largeArc === sweep ? -1 : 1) * Math.sqrt(den > 0 ? num / den : 0);
  const cxp = fac * ((rx * y1p) / ry);
  const cyp = fac * (-(ry * x1p) / rx);

  const cx = co * cxp - si * cyp + (x1 + x2) / 2;
  const cy = si * cxp + co * cyp + (y1 + y2) / 2;

  const vecAng = (ux, uy, vx, vy) => {
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1;
    return sign * Math.acos(Math.max(-1, Math.min(1, dot / len)));
  };

  const vx1 = (x1p - cxp) / rx, vy1 = (y1p - cyp) / ry;
  const vx2 = (-x1p - cxp) / rx, vy2 = (-y1p - cyp) / ry;
  const theta1 = vecAng(1, 0, vx1, vy1);
  let dTheta = vecAng(vx1, vy1, vx2, vy2);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const segsCount = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segsCount;
  const alpha = (4 / 3) * Math.tan(delta / 4);
  const out = [];

  for (let s = 0; s < segsCount; s++) {
    const t1 = theta1 + s * delta;
    const t2 = t1 + delta;
    const c1t = Math.cos(t1), s1t = Math.sin(t1);
    const c2t = Math.cos(t2), s2t = Math.sin(t2);
    const ep1x = c1t - alpha * s1t, ep1y = s1t + alpha * c1t;
    const ep2x = c2t + alpha * s2t, ep2y = s2t - alpha * c2t;
    const mapPt = (px, py) => [
      co * rx * px - si * ry * py + cx,
      si * rx * px + co * ry * py + cy
    ];
    const [p1x, p1y] = mapPt(ep1x, ep1y);
    const [p2x, p2y] = mapPt(ep2x, ep2y);
    const [ex, ey] = s === segsCount - 1 ? [x2, y2] : mapPt(c2t, s2t);
    out.push({ c: 'C', p: [p1x, p1y, p2x, p2y, ex, ey] });
  }
  return out;
}

function svgPathSegs(d) {
  const toks = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  const out = [];
  const need = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 };
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, rc = null, rq = null;

  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++];
    else if (!cmd) { i++; continue; }
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    if (up === 'Z') {
      out.push({ c: 'Z' });
      x = sx; y = sy; rc = null; rq = null; cmd = '';
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
    let nx = x, ny = y, nrc = null, nrq = null;
    if (up === 'M') {
      nx = a[0] + ox; ny = a[1] + oy;
      out.push({ c: 'M', p: [nx, ny] });
      sx = nx; sy = ny;
      cmd = rel ? 'l' : 'L';
    } else if (up === 'L') {
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
    } else if (up === 'Q' || up === 'T') {
      let qx = x, qy = y;
      if (up === 'Q') {
        qx = a[0] + ox; qy = a[1] + oy;
        nx = a[2] + ox; ny = a[3] + oy;
      } else {
        if (rq) { qx = 2 * x - rq[0]; qy = 2 * y - rq[1]; }
        nx = a[0] + ox; ny = a[1] + oy;
      }
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
      nrq = [qx, qy];
    } else if (up === 'A') {
      nx = a[5] + ox; ny = a[6] + oy;
      out.push(...svgArcToCubic(x, y, a[0], a[1], a[2], a[3] !== 0, a[4] !== 0, nx, ny));
    }
    x = nx; y = ny; rc = nrc; rq = nrq;
  }
  return out;
}

function shapeToSegs(el) {
  const tag = (el.tagName || '').toLowerCase();
  const num = (k, def = 0) => {
    const v = parseFloat(el.getAttribute(k));
    return isFinite(v) ? v : def;
  };
  if (tag === 'path') {
    const d = el.getAttribute('d');
    return d ? svgPathSegs(d) : [];
  }
  if (tag === 'rect') {
    const x = num('x'), y = num('y'), w = num('width'), h = num('height');
    if (!(w > 0 && h > 0)) return [];
    let rx = el.hasAttribute('rx') ? num('rx') : el.hasAttribute('ry') ? num('ry') : 0;
    let ry = el.hasAttribute('ry') ? num('ry') : el.hasAttribute('rx') ? num('rx') : 0;
    rx = Math.min(w / 2, Math.max(0, rx));
    ry = Math.min(h / 2, Math.max(0, ry));
    if (rx <= 0 || ry <= 0) {
      return [
        { c: 'M', p: [x, y] },
        { c: 'L', p: [x + w, y] },
        { c: 'L', p: [x + w, y + h] },
        { c: 'L', p: [x, y + h] },
        { c: 'Z' }
      ];
    }
    const k = 0.5522847498;
    const kx = rx * k, ky = ry * k;
    return [
      { c: 'M', p: [x + rx, y] },
      { c: 'L', p: [x + w - rx, y] },
      { c: 'C', p: [x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry] },
      { c: 'L', p: [x + w, y + h - ry] },
      { c: 'C', p: [x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h] },
      { c: 'L', p: [x + rx, y + h] },
      { c: 'C', p: [x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry] },
      { c: 'L', p: [x, y + ry] },
      { c: 'C', p: [x, y + ry - ky, x + rx - kx, y, x + rx, y] },
      { c: 'Z' }
    ];
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = num('cx'), cy = num('cy');
    const rx = tag === 'circle' ? num('r') : num('rx');
    const ry = tag === 'circle' ? num('r') : num('ry');
    if (!(rx > 0 && ry > 0)) return [];
    const k = 0.5522847498, kx = rx * k, ky = ry * k;
    return [
      { c: 'M', p: [cx + rx, cy] },
      { c: 'C', p: [cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry] },
      { c: 'C', p: [cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy] },
      { c: 'C', p: [cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry] },
      { c: 'C', p: [cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy] },
      { c: 'Z' }
    ];
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number).filter(isFinite);
    if (pts.length < 4) return [];
    const segs = [{ c: 'M', p: [pts[0], pts[1]] }];
    for (let i = 2; i + 1 < pts.length; i += 2) {
      segs.push({ c: 'L', p: [pts[i], pts[i + 1]] });
    }
    if (tag === 'polygon') segs.push({ c: 'Z' });
    return segs;
  }
  if (tag === 'line') {
    return [
      { c: 'M', p: [num('x1'), num('y1')] },
      { c: 'L', p: [num('x2'), num('y2')] }
    ];
  }
  return [];
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

function parseStyleMap(el) {
  const map = {};
  const styleAttr = el.getAttribute('style') || '';
  for (const part of styleAttr.split(';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) continue;
    const k = part.slice(0, colon).trim().toLowerCase();
    const v = part.slice(colon + 1).trim();
    if (k && v) map[k] = v;
  }
  const attrs = [
    'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width',
    'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
    'stroke-opacity', 'opacity', 'display', 'visibility'
  ];
  for (const k of attrs) {
    if (!map[k] && el.hasAttribute(k)) {
      map[k] = el.getAttribute(k).trim();
    }
  }
  return map;
}

function svgGradientStops(g, baseOpacity = 1) {
  const stops = [];
  let last = 0;
  for (const s of g.querySelectorAll('stop')) {
    const st = parseStyleMap(s);
    const stopOp = st['stop-opacity'] !== undefined ? parseFloat(st['stop-opacity']) : 1;
    const effOp = baseOpacity * (isFinite(stopOp) ? Math.max(0, Math.min(1, stopOp)) : 1);
    const col = psRGB(st['stop-color'] || 'black', effOp) || [1, 1, 1];
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

function gradientPS(g, bb, vb, opacity = 1) {
  const stops = svgGradientStops(g, opacity);
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
  if (g.tagName.toLowerCase() !== 'radialgradient') {
    const x1 = C('x1', '0%', 'x'), y1 = C('y1', '0%', 'y'), x2 = C('x2', '100%', 'x'), y2 = C('y2', '0%', 'y');
    if (x1 === x2 && y1 === y2) return { solid: last };
    type = 2;
    coords = [x1, y1, x2, y2];
  } else {
    const cx = C('cx', '50%', 'x'), cy = C('cy', '50%', 'y'), r = C('r', '50%', 'r');
    if (!(r > 0)) return { solid: last };
    let fx = g.hasAttribute('fx') ? C('fx', '50%', 'x') : cx;
    let fy = g.hasAttribute('fy') ? C('fy', '50%', 'y') : cy;
    // Clamp focal point strictly inside outer circle (PostScript ShadingType 3 requirement)
    const dist = Math.hypot(fx - cx, fy - cy);
    if (dist >= r * 0.995) {
      const s = (r * 0.995) / dist;
      fx = cx + (fx - cx) * s;
      fy = cy + (fy - cy) * s;
    }
    type = 3;
    coords = [fx, fy, 0, cx, cy, r];
  }
  const gtMat = parseSvgTransform(g.getAttribute('gradientTransform'));
  if (gtMat) {
    pre.push('[' + gtMat.map(epsNum).join(' ') + '] concat');
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
    '%%CreationDate: ' + new Date().toISOString(),
    '%%DocumentData: Clean7Bit',
    '%%BoundingBox: 0 0 ' + Math.ceil(W) + ' ' + Math.ceil(H),
    '%%HiResBoundingBox: 0 0 ' + epsNum(W) + ' ' + epsNum(H),
    '%%LanguageLevel: 3',
    '%%Pages: 1',
    '%%EndComments',
    '%%Page: 1 1',
    'gsave',
    '[' + [k, 0, 0, -k, -vb[0] * k, H + vb[1] * k].map(epsNum).join(' ') + '] concat'
  ];

  const defaultStyle = {
    fill: 'black',
    'fill-rule': 'nonzero',
    'fill-opacity': '1',
    stroke: 'none',
    'stroke-width': '1',
    'stroke-linecap': 'butt',
    'stroke-linejoin': 'miter',
    'stroke-miterlimit': '4',
    'stroke-dasharray': 'none',
    'stroke-opacity': '1',
    opacity: '1'
  };

  const SKIP_TAGS = new Set(['defs', 'metadata', 'title', 'desc', 'clippath', 'mask', 'style', 'script']);
  const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);

  const emitPaint = (segs, ops, style, isStroke) => {
    const paintVal = (isStroke ? style.stroke : style.fill).trim();
    if (!paintVal || paintVal === 'none') return;
    const baseOp = Math.max(0, Math.min(1, parseFloat(style.opacity) || 1));
    const subOp = Math.max(0, Math.min(1, parseFloat(isStroke ? style['stroke-opacity'] : style['fill-opacity']) || 1));
    const effOp = baseOp * subOp;
    if (effOp <= 0) return;

    const ref = /^url\(#([^)]+)\)$/.exec(paintVal);
    let col = ref ? null : psRGB(paintVal, effOp);
    let grad = null;

    if (ref) {
      const g = doc.getElementById(ref[1].replace(/['"]/g, ''));
      grad = g && /gradient$/i.test(g.tagName) ? gradientPS(g, segsBBox(segs), vb, effOp) : null;
      if (grad && grad.solid) col = grad.solid;
    }

    if (isStroke) {
      const sw = parseFloat(style['stroke-width']);
      if (!(sw > 0)) return;
      const capMap = { butt: 0, round: 1, square: 2 };
      const joinMap = { miter: 0, round: 1, bevel: 2 };
      const ml = Math.max(1, parseFloat(style['stroke-miterlimit']) || 4);
      const da = style['stroke-dasharray'];
      const dashOps = [];
      if (da && da !== 'none') {
        const nums = da.split(/[\s,]+/).map(Number).filter(v => isFinite(v) && v >= 0);
        if (nums.length > 0 && nums.some(v => v > 0)) {
          dashOps.push('[' + nums.map(epsNum).join(' ') + '] 0 setdash');
        }
      }

      out.push(
        'gsave',
        epsNum(sw) + ' setlinewidth',
        (capMap[style['stroke-linecap']] ?? 0) + ' setlinecap',
        (joinMap[style['stroke-linejoin']] ?? 0) + ' setlinejoin',
        epsNum(ml) + ' setmiterlimit',
        ...dashOps,
        'newpath',
        ops
      );
      if (grad && grad.dict) {
        out.push('strokepath', 'clip', 'newpath', ...grad.pre, grad.dict, 'shfill', 'grestore');
      } else {
        out.push((col || [0, 0, 0]).map(epsNum).join(' ') + ' setrgbcolor', 'stroke', 'grestore');
      }
      return;
    }

    const eo = style['fill-rule'] === 'evenodd';
    if (grad && grad.dict) {
      out.push('gsave', 'newpath', ops, eo ? 'eoclip' : 'clip', 'newpath', ...grad.pre, grad.dict, 'shfill', 'grestore');
    } else {
      out.push('gsave', (col || [0, 0, 0]).map(epsNum).join(' ') + ' setrgbcolor', 'newpath', ops, eo ? 'eofill' : 'fill', 'grestore');
    }
  };

  const walk = (el, parentStyle) => {
    const tag = (el.tagName || '').toLowerCase();
    if (!tag || SKIP_TAGS.has(tag)) return;

    const local = parseStyleMap(el);
    if (local.display === 'none' || local.visibility === 'hidden') return;

    const merged = { ...parentStyle };
    const parentOp = Math.max(0, Math.min(1, parseFloat(parentStyle.opacity) || 1));
    for (const [key, val] of Object.entries(local)) {
      if (key === 'opacity') {
        const ownOp = Math.max(0, Math.min(1, parseFloat(val)));
        merged.opacity = String(isFinite(ownOp) ? parentOp * ownOp : parentOp);
      } else {
        merged[key] = val;
      }
    }

    const tf = parseSvgTransform(el.getAttribute('transform'));
    if (tf) out.push('gsave', '[' + tf.map(epsNum).join(' ') + '] concat');

    if (SHAPE_TAGS.has(tag)) {
      const segs = shapeToSegs(el);
      if (segs.length) {
        const ops = psOps(segs);
        emitPaint(segs, ops, merged, false);
        emitPaint(segs, ops, merged, true);
      }
    } else {
      for (const child of el.children || []) {
        walk(child, merged);
      }
    }

    if (tf) out.push('grestore');
  };

  walk(root, defaultStyle);

  out.push('grestore', 'showpage', '%%Trailer', '%%EOF');
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
  const numColors = Math.min(32, Math.max(2, options.colors || 18));
  const minSpeckleArea = options.minSpeckleArea ?? 12;
  const metadata = options.metadata || {};
  const maxWorkDim = options.maxResolution || 1600;

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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, workW, workH);

  const imageData = ctx.getImageData(0, 0, workW, workH);
  const suitability = evaluateVectorSuitability(imageData, workW, workH);

  const workerSettings = {
    mode: options.mode || 'auto',
    removeBackground: !!options.removeBackground,
    removeInternalHoles: !!options.removeInternalHoles,
    texture: 'clean',
    quality: options.quality || 'accurate',
    geometry: options.geometry !== false,
    seams: options.seams !== false,
    detail: options.detail !== false,
    preprocess: 'auto',
    colors: numColors,
    threshold: 128,
    smooth: options.smooth ?? 2,
    clean: options.clean ?? 2,
    noise: minSpeckleArea,
    removeWhite: !!options.removeWhite,
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
