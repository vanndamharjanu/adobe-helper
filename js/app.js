import { upscaleImage, isolateSubjectBackground, splitImageIntoQuadrants } from './upscaler.js';
import { convertImageToVector } from './vectorizer.js';
import {
  analyzeImageWithGemini,
  discoverAvailableVisionModels,
  auditAdobeCompliance,
  sanitizeAdobeTitle,
  sanitizeAdobeKeywords,
  getTodayApiUsage,
  generateCustomFlowPrompts
} from './gemini-vision.js';
import {
  ADOBE_CATEGORIES,
  embedMetadataIntoBlob,
  getExportFilename,
  generateAgencyCsv
} from './xmp-exporter.js';
import {
  MONTH_NAMES_ID,
  getNichesByHorizon
} from './niche-prompts.js';

// IndexedDB Queue Persistence (so page refresh does not lose images/metadata)
const DB_NAME = 'microstock_adobe_helper_db';
const DB_STORE = 'queue_items';

function openQueueDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveItemToDb(item) {
  try {
    const db = await openQueueDb();
    const record = {
      id: item.id,
      orderIndex: state.items.findIndex(i => i.id === item.id),
      file: item.file,
      name: item.name,
      originalWidth: item.originalWidth,
      originalHeight: item.originalHeight,
      originalMegapixels: item.originalMegapixels,
      originalSize: item.originalSize,
      status: item.status === 'processing' ? 'waiting' : item.status,
      metadata: item.metadata,
      upscaledWidth: item.upscaledWidth,
      upscaledHeight: item.upscaledHeight,
      upscaledMegapixels: item.upscaledMegapixels,
      upscaledBlob: item.upscaledBlob || null,
      upscaledSize: item.upscaledSize || null,
      exportExt: item.exportExt || null,
      isIsolated: Boolean(item.isIsolated),
      isolatedBlob: item.isolatedBlob || null,
      isVectorized: Boolean(item.isVectorized),
      svgString: item.svgString || null,
      epsString: item.epsString || null,
      vectorPathCount: item.vectorPathCount || 0,
      vectorColorCount: item.vectorColorCount || 0,
      vectorSuitability: item.vectorSuitability || null
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Persist item warning:', err);
  }
}

async function deleteItemFromDb(id) {
  try {
    const db = await openQueueDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Delete item warning:', err);
  }
}

async function clearQueueDb() {
  try {
    const db = await openQueueDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Clear DB warning:', err);
  }
}

async function restoreQueueFromDb() {
  try {
    const db = await openQueueDb();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    if (!records.length) return;

    records.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    state.items = records.map(rec => {
      const item = {
        ...rec,
        stepText: '',
        previewUrl: rec.file ? URL.createObjectURL(rec.file) : '',
        upscaledUrl: rec.upscaledBlob ? URL.createObjectURL(rec.upscaledBlob) : null,
        isolatedUrl: rec.isolatedBlob ? URL.createObjectURL(rec.isolatedBlob) : null,
        svgBlob: rec.svgString ? new Blob([rec.svgString], { type: 'image/svg+xml;charset=utf-8' }) : null,
        epsBlob: rec.epsString ? new Blob([rec.epsString], { type: 'application/postscript' }) : null
      };
      if (item.svgBlob) item.svgUrl = URL.createObjectURL(item.svgBlob);
      if (item.epsBlob) item.epsUrl = URL.createObjectURL(item.epsBlob);
      item.audit = auditAdobeCompliance(item);
      return item;
    });
    refreshStatsAndGrid();
  } catch (err) {
    console.warn('Restore queue warning:', err);
  }
}

// Application State
const state = {
  items: [],
  activeItemId: null,
  activeFilter: 'all',
  searchQuery: '',
  isBatchRunning: false,
  exportAgency: 'adobe',
  compareViewMode: 'raster', // 'raster' | 'vector'
  compareZoom: 1,
  settings: {
    targetScale: '8mp',
    profile: 'ai-photorealistic',
    sharpness: 0.75,
    outputFormat: 'image/jpeg',
    jpegQuality: 95,
    vectorColors: 18,
    minSpeckleArea: 12,
    autoIsolateBg: false,
    bgTolerance: 24,
    bgMode: 'transparent',
    keywordCount: 42,
    assetStyle: 'ai-auto',
    focusTheme: '',
    preferredModel: (() => {
      const saved = localStorage.getItem('adobe_helper_gemini_model');
      if (!saved || saved === 'gemini-2.5-flash' || saved === 'gemini-2.0-flash' || saved === 'gemini-1.5-flash') {
        localStorage.setItem('adobe_helper_gemini_model', 'gemini-3.8-flash');
        return 'gemini-3.8-flash';
      }
      return saved;
    })()
  }
};

// Bootstrap Modal instances
let inspectModalInstance = null;
let apiKeyModalInstance = null;
let exportModalInstance = null;
let guideModalInstance = null;
let nicheModalInstance = null;

// Niche Explorer State
const nicheState = {
  horizon: 'ahead_3_6',
  baseMonth: new Date().getMonth(),
  seedMap: {},
  customNiches: []
};

function formatBytes(bytes = 0) {
  if (!bytes) return '0 KB';
  const mb = bytes / 1048576;
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function showToast(title, message = '', type = 'primary') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const iconMap = {
    success: 'bi-check-circle-fill text-success',
    danger: 'bi-exclamation-octagon-fill text-danger',
    warning: 'bi-exclamation-triangle-fill text-warning',
    primary: 'bi-info-circle-fill text-primary'
  };

  const toastEl = document.createElement('div');
  toastEl.className = 'toast align-items-center bg-white border shadow-sm rounded-3 show mb-2';
  toastEl.setAttribute('role', 'alert');
  toastEl.innerHTML = `
    <div class="d-flex p-3 align-items-start">
      <i class="bi ${iconMap[type] || iconMap.primary} fs-5 me-2 mt-1 flex-shrink-0" style="line-height:1;"></i>
      <div class="me-auto min-w-0 text-break">
        <div class="fw-bold text-navy small">${title}</div>
        ${message ? `<div class="text-muted mt-1" style="font-size:0.78rem;">${message}</div>` : ''}
      </div>
      <button type="button" class="btn-close ms-2" data-bs-dismiss="toast"></button>
    </div>
  `;
  container.appendChild(toastEl);

  setTimeout(() => {
    toastEl.remove();
  }, 4500);
}

function updateApiKeyBanner() {
  const savedKeys = (localStorage.getItem('adobe_helper_gemini_keys') || '').trim();
  const hasKey = savedKeys.length > 10;
  const banner = document.getElementById('missingKeyAlert');
  const btnOpen = document.getElementById('btnOpenApiModal');
  const statusSpan = document.getElementById('apiKeyStatusBadge');
  const usage = getTodayApiUsage();

  if (banner) {
    banner.classList.toggle('d-none', hasKey);
  }
  if (btnOpen && statusSpan) {
    if (hasKey) {
      btnOpen.className = 'btn btn-sm bg-light-primary border border-primary-subtle';
      statusSpan.textContent = `API (${usage.remainingRequests} sisa)`;
    } else {
      btnOpen.className = 'btn btn-sm bg-light-warning border border-warning-subtle';
      statusSpan.textContent = 'API Key';
    }
  }

  const reqUsedEl = document.getElementById('statApiReqUsed');
  const tokUsedEl = document.getElementById('statApiTokensUsed');
  const reqRemEl = document.getElementById('statApiReqRemaining');
  if (reqUsedEl) reqUsedEl.textContent = usage.requests.toLocaleString('id-ID');
  if (tokUsedEl) tokUsedEl.textContent = usage.totalTokens.toLocaleString('id-ID');
  if (reqRemEl) reqRemEl.textContent = usage.remainingRequests.toLocaleString('id-ID');
}

function renderNicheCards() {
  const container = document.getElementById('nicheCardsContainer');
  if (!container) return;

  const calendarNiches = getNichesByHorizon(nicheState.horizon, nicheState.baseMonth, nicheState.seedMap);
  const allNiches = [...nicheState.customNiches, ...calendarNiches];

  container.innerHTML = allNiches.map(niche => {
    const promptsHtml = (niche.prompts || []).map(p => `
      <div class="p-2 rounded-2 bg-light border d-flex flex-column gap-1">
        <div class="d-flex justify-content-between align-items-center gap-2">
          <span class="badge bg-white text-navy border text-wrap text-start">${p.style}</span>
          <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 flex-shrink-0" style="font-size: 0.74rem;" data-copy-prompt="${encodeURIComponent(p.prompt)}">
            Salin Prompt
          </button>
        </div>
        <div class="font-monospace text-muted text-break" style="font-size: 0.75rem; line-height: 1.45;">
          ${p.prompt}
        </div>
      </div>
    `).join('');

    const kwHtml = (niche.keywords || []).slice(0, 8).map(k => `<span class="badge bg-white text-muted border fw-normal">${k}</span>`).join(' ');
    const hasSubPool = Array.isArray(niche.subSubjects) && niche.subSubjects.length > 3;

    return `
      <div class="col-12 col-md-6 col-xl-4">
        <div class="pro-card p-3 h-100 d-flex flex-column justify-content-between gap-2">
          <div>
            <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
              <span class="badge bg-light-primary border border-primary-subtle text-wrap text-start">${niche.timingLabel || niche.demandLevel}</span>
              <div class="d-flex gap-1">
                ${hasSubPool ? `
                  <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size: 0.74rem;" data-shuffle-niche="${niche.id}">
                    Acak 3 Subjek Lain
                  </button>
                ` : ''}
                <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size: 0.74rem;" data-apply-theme="${encodeURIComponent(niche.title)}">
                  Pakai Tema
                </button>
              </div>
            </div>
            <h6 class="fw-bold text-navy mb-1 text-break" style="font-size: 0.95rem;">${niche.title}</h6>
            <div class="text-muted mb-2 text-break" style="font-size: 0.77rem;">
              Target: ${niche.buyerTarget}
            </div>
            <div class="d-flex flex-wrap gap-1 mb-2">
              ${kwHtml}
            </div>
            <div class="d-flex flex-column gap-2">
              ${promptsHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function populateCategoryDropdown() {
  const sel = document.getElementById('modalSelectCategory');
  if (!sel) return;
  sel.innerHTML = ADOBE_CATEGORIES.map(
    c => `<option value="${c.name}">${c.id}. ${c.name}</option>`
  ).join('');
}

function getFilteredItems() {
  return state.items.filter(it => {
    const mp = it.upscaledMegapixels || it.originalMegapixels || 0;
    const hasMeta = it.metadata && it.metadata.title && (it.metadata.keywords?.length || 0) >= 25;
    if (state.activeFilter === 'ready' && !(mp >= 4.0 && hasMeta)) return false;
    if (state.activeFilter === 'need_upscale' && mp >= 4.0) return false;
    if (state.activeFilter === 'vector' && !it.isVectorized) return false;
    if (state.activeFilter === 'issues' && (!it.audit || it.audit.issues.length === 0)) return false;

    if (state.searchQuery.trim()) {
      const q = state.searchQuery.toLowerCase();
      const inName = it.name.toLowerCase().includes(q);
      const inTitle = (it.metadata?.title || '').toLowerCase().includes(q);
      const inKw = (it.metadata?.keywords || []).some(k => k.toLowerCase().includes(q));
      if (!inName && !inTitle && !inKw) return false;
    }
    return true;
  });
}

function getNavigableItems() {
  const filtered = getFilteredItems();
  if (filtered.length > 1 && filtered.some(it => String(it.id) === String(state.activeItemId))) {
    return filtered;
  }
  if (state.items && state.items.length > 0) {
    return state.items;
  }
  return filtered;
}

function refreshStatsAndGrid() {
  const total = state.items.length;
  const ready = state.items.filter(it => {
    const mp = it.upscaledMegapixels || it.originalMegapixels || 0;
    const hasMeta = it.metadata && it.metadata.title && (it.metadata.keywords?.length || 0) >= 25;
    return mp >= 4.0 && hasMeta && (it.audit?.score || 0) >= 80;
  }).length;
  const needUpscale = state.items.filter(it => (it.upscaledMegapixels || it.originalMegapixels || 0) < 4.0).length;
  const vectorized = state.items.filter(it => it.isVectorized).length;

  document.getElementById('statTotalCount').textContent = total;
  document.getElementById('statReadyCount').textContent = ready;
  document.getElementById('statNeedUpscaleCount').textContent = needUpscale;
  document.getElementById('statVectorCount').textContent = vectorized;
  document.getElementById('queueCounterBadge').textContent = `${total} / 100`;

  if (state.activeItemId) {
    updateModalNavButtons();
  }

  const emptyState = document.getElementById('emptyQueueState');
  const grid = document.getElementById('assetsGrid');

  if (total === 0) {
    emptyState.classList.remove('d-none');
    grid.classList.add('d-none');
    grid.innerHTML = '';
    return;
  }

  emptyState.classList.add('d-none');
  grid.classList.remove('d-none');

  // Filter items
  const filtered = getFilteredItems();

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-12">
        <div class="pro-card p-4 text-center text-muted small">
          Tidak ada gambar yang cocok dengan filter atau pencarian saat ini.
        </div>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(item => {
    const mp = item.upscaledMegapixels || item.originalMegapixels || 0;
    const w = item.upscaledWidth || item.originalWidth;
    const h = item.upscaledHeight || item.originalHeight;
    const isMpOk = mp >= 4.0;
    const thumbSrc = item.upscaledUrl || item.previewUrl;
    const hasMeta = item.metadata && item.metadata.title;
    const kwCount = item.metadata?.keywords?.length || 0;

    let statusBadge = `<span class="badge bg-dark bg-opacity-75">Menunggu</span>`;
    if (item.status === 'processing') {
      statusBadge = `<span class="badge bg-primary"><span class="spinner-border spinner-border-sm me-1" style="width:10px;height:10px;"></span>${item.stepText || 'Memproses...'}</span>`;
    } else if (item.status === 'done') {
      statusBadge = `<span class="badge bg-primary">Selesai</span>`;
    } else if (item.status === 'error') {
      statusBadge = `<span class="badge bg-danger">Perlu Cek</span>`;
    }

    return `
      <div class="col-12 col-md-6 col-xl-4">
        <div class="pro-card pro-card-hover h-100 d-flex flex-column">
          <div class="asset-thumb-wrapper" data-action="inspect" data-id="${item.id}">
            <img src="${thumbSrc}" alt="${item.name}" loading="lazy" />
            <div class="position-absolute top-0 start-0 m-2 d-flex gap-1 flex-wrap">
              ${statusBadge}
              ${item.isVectorized ? '<span class="badge bg-white text-navy border">SVG / EPS</span>' : ''}
              ${item.isIsolated ? '<span class="badge bg-white text-navy border">Cutout</span>' : ''}
            </div>
            <div class="position-absolute top-0 end-0 m-2">
              <span class="badge ${isMpOk ? 'bg-dark bg-opacity-75' : 'bg-danger'} font-monospace">
                ${mp.toFixed(1)} MP
              </span>
            </div>
          </div>

          <div class="p-3 flex-grow-1 d-flex flex-column justify-content-between gap-2">
            <div>
              <div class="d-flex justify-content-between align-items-start gap-2 mb-1">
                <div class="fw-semibold text-navy small text-truncate" style="cursor:pointer;" data-action="inspect" data-id="${item.id}" title="${item.name}">
                  ${item.name}
                </div>
                <span class="font-monospace text-muted flex-shrink-0" style="font-size:0.74rem;">
                  ${formatBytes(item.upscaledSize || item.originalSize)}
                </span>
              </div>

              <div class="font-monospace text-muted mb-2" style="font-size:0.74rem;">
                ${w} × ${h} px${item.upscaledUrl ? ' • <span class="text-primary fw-semibold">Upscaled</span>' : ''}
              </div>

              <div class="p-2 rounded-2 border bg-light">
                ${hasMeta ? `
                  <div class="fw-medium text-navy small text-break mb-1" style="line-height:1.35;">
                    ${item.metadata.title}
                  </div>
                  <div class="d-flex align-items-center justify-content-between flex-wrap gap-1" style="font-size:0.74rem;">
                    <span class="text-muted">${item.metadata.category || 'Graphic Resources'}</span>
                    <span class="font-monospace text-primary fw-semibold">${kwCount} tags</span>
                  </div>
                ` : `
                  <div class="text-muted small">
                    Metadata belum dibuat
                  </div>
                `}
              </div>
            </div>

            ${item.isVectorized ? `
              <div class="p-2 rounded-2 bg-light-primary border border-primary-subtle d-flex align-items-center justify-content-between gap-2">
                <div class="min-w-0 d-flex align-items-center gap-1">
                  <i class="bi bi-vector-pen text-primary"></i>
                  <span class="small fw-semibold text-navy text-truncate" style="font-size:0.75rem;">Vector Siap</span>
                  <span class="text-muted font-monospace d-none d-sm-inline" style="font-size:0.7rem;">(${item.vectorPathCount || 0} kurva)</span>
                </div>
                <div class="d-flex gap-1 flex-shrink-0">
                  <button type="button" class="btn btn-sm btn-dark py-1 px-2 d-flex align-items-center gap-1 font-monospace" data-action="download-svg" data-id="${item.id}" title="Unduh File Vector .SVG" style="font-size:0.75rem;">
                    <i class="bi bi-download"></i>SVG
                  </button>
                  <button type="button" class="btn btn-sm btn-outline-dark bg-white py-1 px-2 d-flex align-items-center gap-1 font-monospace" data-action="download-eps" data-id="${item.id}" title="Unduh File Vector .EPS" style="font-size:0.75rem;">
                    <i class="bi bi-download"></i>EPS
                  </button>
                </div>
              </div>
            ` : ''}

            <div class="pt-2 border-top d-flex align-items-center justify-content-between gap-1 flex-wrap">
              <div class="d-flex gap-1 flex-wrap">
                <button type="button" class="btn btn-sm btn-outline-primary py-1 px-2" data-action="upscale" data-id="${item.id}">
                  Upscale
                </button>
                <button type="button" class="btn btn-sm btn-outline-primary py-1 px-2" data-action="meta" data-id="${item.id}">
                  Meta
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary py-1 px-2" data-action="vector" data-id="${item.id}">
                  SVG
                </button>
                <button type="button" class="btn btn-sm btn-outline-secondary py-1 px-2" data-action="split4" data-id="${item.id}" title="Pecah Grid 2x2 menjadi 4 gambar terpisah">
                  Pecah 4
                </button>
              </div>

              <div class="d-flex gap-1">
                <button type="button" class="btn btn-sm btn-outline-secondary py-1 px-2" data-action="inspect" data-id="${item.id}" title="Edit">
                  Edit
                </button>
                <button type="button" class="btn btn-sm btn-brand py-1 px-2" data-action="download" data-id="${item.id}" title="Download">
                  <i class="bi bi-download"></i>
                </button>
                <button type="button" class="btn btn-sm btn-outline-danger py-1 px-2" data-action="remove" data-id="${item.id}" title="Hapus">
                  <i class="bi bi-trash3"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Reads uploaded files and adds them to queue WITHOUT inventing fake metadata
 */
async function handleFilesAdded(fileList) {
  const validFiles = Array.from(fileList).filter(
    f => /^image\/(jpe?g|png|webp)$/i.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)
  );
  if (validFiles.length === 0) {
    showToast('Format Tidak Didukung', 'Pilih file gambar berformat JPG, PNG, atau WEBP.', 'warning');
    return;
  }

  for (const file of validFiles) {
    if (state.items.length >= 100) break;

    const previewUrl = URL.createObjectURL(file);
    const dims = await new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 1024, h: img.naturalHeight || 1024 });
      img.onerror = () => resolve({ w: 1024, h: 1024 });
      img.src = previewUrl;
    });

    const mp = (dims.w * dims.h) / 1e6;
    const item = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name,
      originalWidth: dims.w,
      originalHeight: dims.h,
      originalMegapixels: mp,
      originalSize: file.size,
      previewUrl,
      status: 'waiting',
      stepText: '',
      metadata: null
    };
    item.audit = auditAdobeCompliance(item);
    state.items.push(item);
    await saveItemToDb(item);
  }

  refreshStatsAndGrid();
  showToast('Gambar Ditambahkan', `${validFiles.length} gambar siap diproses.`, 'success');
}

/**
 * Single Item Operations
 */
async function runSingleUpscale(item) {
  item.status = 'processing';
  item.stepText = 'Upscaling...';
  refreshStatsAndGrid();

  try {
    let sourceUrl = item.previewUrl;
    if (state.settings.autoIsolateBg) {
      const iso = await isolateSubjectBackground(sourceUrl, {
        tolerance: state.settings.bgTolerance,
        fillWhite: state.settings.bgMode === 'white'
      });
      item.isIsolated = true;
      item.isolatedBlob = iso.blob;
      item.isolatedUrl = iso.url;
      sourceUrl = iso.url;
    }

    const res = await upscaleImage(sourceUrl, item.originalWidth, item.originalHeight, {
      targetScale: state.settings.targetScale,
      profile: state.settings.profile,
      sharpness: state.settings.sharpness,
      outputFormat: item.isIsolated && state.settings.bgMode === 'transparent' ? 'image/png' : state.settings.outputFormat,
      jpegQuality: state.settings.jpegQuality
    });

    let finalBlob = res.blob;
    if (item.metadata && item.metadata.title) {
      finalBlob = await embedMetadataIntoBlob(finalBlob, item.metadata);
    }

    item.upscaledWidth = res.width;
    item.upscaledHeight = res.height;
    item.upscaledMegapixels = res.megapixels;
    item.upscaledBlob = finalBlob;
    item.upscaledUrl = res.url;
    item.upscaledSize = finalBlob.size;
    item.exportExt = finalBlob.type === 'image/png' ? '.png' : '.jpg';
    item.status = 'done';
    item.stepText = '';
    item.audit = auditAdobeCompliance(item);
    await saveItemToDb(item);
  } catch (err) {
    console.error('Upscale error:', err);
    item.status = 'error';
    item.stepText = 'Gagal Upscale';
    showToast('Gagal Upscale', err.message, 'danger');
  }

  refreshStatsAndGrid();
  if (state.activeItemId === item.id) {
    renderInspectModal(item);
  }
}

async function runSingleVisionMeta(item) {
  const savedKeys = (localStorage.getItem('adobe_helper_gemini_keys') || '').trim();
  if (!savedKeys) {
    apiKeyModalInstance?.show();
    showToast('API Key Diperlukan', 'Masukkan API Key Gemini gratis Anda terlebih dahulu agar gambar dapat dianalisis secara visual.', 'warning');
    return;
  }

  item.status = 'processing';
  item.stepText = 'Vision AI...';
  refreshStatsAndGrid();

  try {
    const meta = await analyzeImageWithGemini(item, {
      keywordCount: state.settings.keywordCount,
      assetStyle: state.settings.assetStyle,
      focusTheme: state.settings.focusTheme,
      preferredModel: state.settings.preferredModel,
      isVector: item.isVectorized
    });

    item.metadata = meta;
    if (item.upscaledBlob) {
      item.upscaledBlob = await embedMetadataIntoBlob(item.upscaledBlob, meta);
      item.upscaledSize = item.upscaledBlob.size;
    }
    item.status = 'done';
    item.stepText = '';
    item.audit = auditAdobeCompliance(item);
    await saveItemToDb(item);
  } catch (err) {
    console.error('Gemini Vision error:', err);
    item.status = 'error';
    item.stepText = 'Error API';
    showToast('Gagal Analisis Vision AI', err.message, 'danger');
  }

  refreshStatsAndGrid();
  if (state.activeItemId === item.id) {
    renderInspectModal(item);
  }
}

async function runSingleVectorize(item) {
  item.status = 'processing';
  item.stepText = 'Tracing SVG...';
  refreshStatsAndGrid();

  try {
    const srcUrl = item.isolatedUrl || item.previewUrl;

    const vec = await convertImageToVector(srcUrl, {
      colors: state.settings.vectorColors,
      minSpeckleArea: state.settings.minSpeckleArea,
      removeBackground: !!state.settings.autoIsolateBg && !item.isIsolated,
      metadata: item.metadata || {},
      onProgress: (phase) => {
        item.stepText = phase;
      }
    });

    item.isVectorized = true;
    item.svgString = vec.svgString;
    item.epsString = vec.epsString;
    item.svgBlob = vec.svgBlob;
    item.epsBlob = vec.epsBlob;
    item.svgUrl = vec.svgUrl;
    item.epsUrl = vec.epsUrl;
    item.vectorPathCount = vec.pathCount;
    item.vectorColorCount = vec.colorCount;
    item.vectorSuitability = vec.suitability;
    item.status = 'done';
    item.stepText = '';
    item.audit = auditAdobeCompliance(item);
    await saveItemToDb(item);

    showToast('Konversi Vector Selesai', `${item.name}: ${vec.pathCount} bentuk (${vec.colorCount} warna, mode ${vec.engine || 'Hybrid'}) siap diunduh.`, 'success');
  } catch (err) {
    console.error('Vectorize error:', err);
    item.status = 'error';
    item.stepText = 'Gagal Vector';
    showToast('Gagal Konversi Vector', err.message, 'danger');
  }

  refreshStatsAndGrid();
  if (state.activeItemId === item.id) {
    state.compareViewMode = 'vector';
    renderInspectModal(item);
  }
}

async function runSingleSplitFour(item) {
  item.status = 'processing';
  item.stepText = 'Memotong 4...';
  refreshStatsAndGrid();

  try {
    const baseName = item.name.replace(/\.[^/.]+$/, '');
    const parts = await splitImageIntoQuadrants(item.previewUrl, 'image/png');
    const newItems = [];

    for (const part of parts) {
      const partName = `${baseName}_part${part.index}.png`;
      const partFile = new File([part.blob], partName, { type: 'image/png' });
      const mp = (part.width * part.height) / 1e6;

      const newItem = {
        id: `item-${Date.now()}-${part.index}-${Math.random().toString(36).slice(2, 6)}`,
        file: partFile,
        name: partName,
        originalWidth: part.width,
        originalHeight: part.height,
        originalMegapixels: mp,
        originalSize: part.blob.size,
        previewUrl: part.url,
        status: 'waiting',
        stepText: '',
        metadata: null
      };
      newItem.audit = auditAdobeCompliance(newItem);
      newItems.push(newItem);
      await saveItemToDb(newItem);
    }

    // Replace or insert right after the original 2x2 grid item
    const origIdx = state.items.findIndex(i => i.id === item.id);
    if (origIdx !== -1) {
      state.items.splice(origIdx + 1, 0, ...newItems);
    } else {
      state.items.push(...newItems);
    }

    item.status = 'done';
    item.stepText = '';
    await saveItemToDb(item);
    refreshStatsAndGrid();

    if (state.activeItemId === item.id) {
      inspectModalInstance?.hide();
    }
    showToast('Berhasil Dipecah Jadi 4 Gambar', `4 objek (${baseName}_part1 s/d part4) telah dipotong & dirapikan ke antrean.`, 'success');
  } catch (err) {
    console.error('Split 4 error:', err);
    item.status = 'error';
    item.stepText = 'Gagal Potong';
    refreshStatsAndGrid();
    showToast('Gagal Memotong Gambar', err.message, 'danger');
  }
}

function downloadSvgAsset(item) {
  if (!item) return;
  if (!item.svgUrl) {
    if (item.svgBlob) {
      item.svgUrl = URL.createObjectURL(item.svgBlob);
    } else if (item.svgString) {
      item.svgBlob = new Blob([item.svgString], { type: 'image/svg+xml;charset=utf-8' });
      item.svgUrl = URL.createObjectURL(item.svgBlob);
    }
  }
  if (!item.svgUrl) {
    showToast('Vector Belum Siap', 'File SVG belum dibuat untuk gambar ini.', 'warning');
    return;
  }
  const base = item.name.replace(/\.[^/.]+$/, '');
  const a = document.createElement('a');
  a.href = item.svgUrl;
  a.download = `${base}_vector.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('Download .SVG', `${base}_vector.svg berhasil diunduh.`, 'success');
}

function downloadEpsAsset(item) {
  if (!item) return;
  if (!item.epsUrl) {
    if (item.epsBlob) {
      item.epsUrl = URL.createObjectURL(item.epsBlob);
    } else if (item.epsString) {
      item.epsBlob = new Blob([item.epsString], { type: 'application/postscript' });
      item.epsUrl = URL.createObjectURL(item.epsBlob);
    }
  }
  if (!item.epsUrl) {
    showToast('Vector Belum Siap', 'File EPS belum dibuat untuk gambar ini.', 'warning');
    return;
  }
  const base = item.name.replace(/\.[^/.]+$/, '');
  const a = document.createElement('a');
  a.href = item.epsUrl;
  a.download = `${base}_vector.eps`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('Download .EPS', `${base}_vector.eps berhasil diunduh.`, 'success');
}

async function downloadSingleAsset(item, embedXmp = true) {
  try {
    let blob = item.upscaledBlob || item.isolatedBlob || item.file;
    if (embedXmp && item.metadata && item.metadata.title) {
      blob = await embedMetadataIntoBlob(blob, item.metadata);
    }

    const ext = blob.type === 'image/png' ? '.png' : '.jpg';
    item.exportExt = ext;
    const outName = getExportFilename(item);

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast('File Diunduh', `${outName} berhasil disimpan (Metadata XMP tersemat).`, 'success');
  } catch (err) {
    showToast('Gagal Mengunduh', err.message, 'danger');
  }
}

/**
 * Batch Queue Runner
 */
async function runBatchQueue(itemsToProcess, workerFn, labelText) {
  if (state.isBatchRunning || itemsToProcess.length === 0) return;

  state.isBatchRunning = true;
  const progBox = document.getElementById('batchProgressBox');
  const progLabel = document.getElementById('batchProgressLabel');
  const progCounter = document.getElementById('batchProgressCounter');
  const progBar = document.getElementById('batchProgressBar');

  progBox.classList.remove('d-none');
  const total = itemsToProcess.length;
  let completed = 0;

  for (const item of itemsToProcess) {
    progLabel.innerHTML = `<span class="spinner-border spinner-border-sm text-primary" role="status"></span><span>${labelText}: ${item.name}</span>`;
    progCounter.textContent = `${completed} / ${total} (${Math.round((completed / total) * 100)}%)`;
    progBar.style.width = `${Math.round((completed / total) * 100)}%`;

    await workerFn(item);
    completed++;

    progCounter.textContent = `${completed} / ${total} (${Math.round((completed / total) * 100)}%)`;
    progBar.style.width = `${Math.round((completed / total) * 100)}%`;
  }

  state.isBatchRunning = false;
  setTimeout(() => {
    progBox.classList.add('d-none');
  }, 800);
  showToast('Proses Batch Selesai', `${completed} aset telah selesai diproses.`, 'success');
}

/**
 * Inspect & Metadata Modal Rendering & Navigation
 */
function resetZoom() {
  state.compareZoom = 1;
  document.querySelectorAll('#zoomBtnGroup button').forEach(b => {
    b.classList.toggle('active', b.dataset.zoom === '1');
  });
  const beforeImg = document.getElementById('compareBeforeImg');
  const afterImg = document.getElementById('compareAfterImg');
  if (beforeImg) beforeImg.style.transform = 'scale(1)';
  if (afterImg) afterImg.style.transform = 'scale(1)';
  const compareClip = document.getElementById('compareClip');
  if (compareClip) compareClip.style.width = '50%';
  const compareStage = document.getElementById('compareStage');
  const compareBeforeInner = document.getElementById('compareBeforeInner');
  if (compareStage && compareBeforeInner && compareStage.offsetWidth > 0) {
    compareBeforeInner.style.width = `${compareStage.offsetWidth}px`;
  }
}

function updateModalNavButtons() {
  const items = getNavigableItems();
  const index = items.findIndex(i => String(i.id) === String(state.activeItemId));
  const total = items.length;

  const counterText = total > 0 && index !== -1 ? `${index + 1} / ${total}` : (total > 0 ? `1 / ${total}` : '0 / 0');
  const counterEl = document.getElementById('modalAssetCounter');
  if (counterEl) counterEl.textContent = counterText;

  const hasMultiple = total > 1;

  const btnPrev = document.getElementById('btnModalPrev');
  const btnNext = document.getElementById('btnModalNext');
  if (btnPrev) btnPrev.disabled = !hasMultiple;
  if (btnNext) btnNext.disabled = !hasMultiple;

  const btnStagePrev = document.getElementById('btnStagePrev');
  const btnStageNext = document.getElementById('btnStageNext');
  if (btnStagePrev) btnStagePrev.disabled = !hasMultiple;
  if (btnStageNext) btnStageNext.disabled = !hasMultiple;
}

function navigateInspectModal(direction) {
  if (!state.activeItemId && state.items.length > 0) {
    state.activeItemId = state.items[0].id;
  }
  if (!state.activeItemId) return;

  syncActiveModalMetadata();
  const items = getNavigableItems();
  if (items.length <= 1) return;

  let currentIndex = items.findIndex(i => String(i.id) === String(state.activeItemId));
  if (currentIndex === -1) currentIndex = 0;

  let targetIndex = currentIndex + direction;
  // Circular wrap-around navigation
  if (targetIndex < 0) {
    targetIndex = items.length - 1;
  } else if (targetIndex >= items.length) {
    targetIndex = 0;
  }

  const nextItem = items[targetIndex];
  if (nextItem) {
    state.activeItemId = nextItem.id;
    state.compareViewMode = nextItem.isVectorized && !nextItem.upscaledUrl ? 'vector' : 'raster';
    resetZoom();
    renderInspectModal(nextItem);
  }
}

function openInspectModal(itemId) {
  const item = state.items.find(i => i.id === itemId);
  if (!item) return;
  state.activeItemId = item.id;
  state.compareViewMode = item.isVectorized && !item.upscaledUrl ? 'vector' : 'raster';
  resetZoom();
  renderInspectModal(item);
  inspectModalInstance?.show();
}

function renderInspectModal(item) {
  if (!item) return;

  const mp = item.upscaledMegapixels || item.originalMegapixels || 0;
  const w = item.upscaledWidth || item.originalWidth;
  const h = item.upscaledHeight || item.originalHeight;
  item.audit = auditAdobeCompliance(item);

  document.getElementById('modalAssetFilename').textContent = item.name;
  const resBadge = document.getElementById('modalResBadge');
  resBadge.textContent = `${w}×${h} (${mp.toFixed(2)} MP)`;
  resBadge.className = `badge ${mp >= 4.0 ? 'bg-light-success' : 'bg-light-danger'} font-monospace`;

  const qcBadge = document.getElementById('modalQcScoreBadge');
  qcBadge.textContent = `Skor QC: ${item.audit.score}/100`;
  qcBadge.className = `badge ${item.audit.score >= 85 ? 'bg-light-success' : 'bg-light-warning'}`;

  // Comparison Images
  const beforeImg = document.getElementById('compareBeforeImg');
  const afterImg = document.getElementById('compareAfterImg');
  beforeImg.src = item.previewUrl;

  if (state.compareViewMode === 'vector' && item.svgUrl) {
    afterImg.src = item.svgUrl;
    document.getElementById('labelAfterDim').textContent = `Vector SVG (${item.vectorPathCount} paths)`;
  } else {
    afterImg.src = item.upscaledUrl || item.isolatedUrl || item.previewUrl;
    document.getElementById('labelAfterDim').textContent = item.upscaledUrl
      ? `Upscaled ${w}×${h} (${mp.toFixed(2)} MP)`
      : 'Original';
  }
  document.getElementById('labelBeforeDim').textContent = `Original ${item.originalWidth}×${item.originalHeight}`;

  document.getElementById('btnViewRasterMode').classList.toggle('active', state.compareViewMode === 'raster');
  document.getElementById('btnViewVectorMode').classList.toggle('active', state.compareViewMode === 'vector');

  // Vector Box
  const vecBox = document.getElementById('modalVectorBox');
  if (item.isVectorized) {
    vecBox.classList.remove('d-none');
    document.getElementById('modalVectorStats').textContent = `${item.vectorPathCount} Kurva Bezier • ${item.vectorColorCount} Warna`;
    const adv = document.getElementById('modalVectorAdvisor');
    if (item.vectorSuitability) {
      adv.className = `small p-2 rounded-2 mb-2 ${item.vectorSuitability.isPhotographic ? 'bg-light-warning' : 'bg-light-success'}`;
      adv.textContent = item.vectorSuitability.recommendation;
    }
  } else {
    vecBox.classList.add('d-none');
  }

  // Audit List
  const auditList = document.getElementById('modalAuditList');
  const issueCountBadge = document.getElementById('modalIssueCount');
  if (item.audit.issues.length === 0) {
    issueCountBadge.className = 'badge bg-light-primary';
    issueCountBadge.textContent = 'Siap Upload';
    auditList.innerHTML = `
      <div class="p-2 rounded-2 bg-light-primary small">
        Resolusi, judul, dan kata kunci telah memenuhi standar kurasi.
      </div>
    `;
  } else {
    issueCountBadge.className = 'badge bg-light-warning';
    issueCountBadge.textContent = `${item.audit.issues.length} Catatan`;
    auditList.innerHTML = item.audit.issues.map(iss => {
      const cls = iss.severity === 'error' ? 'bg-light-danger' : iss.severity === 'warning' ? 'bg-light-warning' : 'bg-light-info';
      return `<div class="p-2 rounded-2 ${cls} small">${iss.message}</div>`;
    }).join('');
  }

  // Metadata Inputs
  const meta = item.metadata || {
    title: '',
    description: '',
    keywords: [],
    category: 'Graphic Resources',
    fictionalPeople: false
  };

  const titleInput = document.getElementById('modalInputTitle');
  const descInput = document.getElementById('modalInputDesc');
  const catSelect = document.getElementById('modalSelectCategory');
  const ficCheck = document.getElementById('modalCheckFictional');

  titleInput.value = meta.title || '';
  descInput.value = meta.description || '';
  catSelect.value = meta.category || 'Graphic Resources';
  ficCheck.checked = Boolean(meta.fictionalPeople);

  updateCharCounters(meta.title || '', meta.description || '');
  renderKeywordPills(meta.keywords || []);
  updateModalNavButtons();
}

function updateCharCounters(title, desc) {
  const tLen = (title || '').length;
  const dLen = (desc || '').length;
  const tEl = document.getElementById('modalTitleCharCount');
  tEl.textContent = `${tLen} / 70`;
  tEl.className = `font-monospace small ${tLen >= 50 && tLen <= 72 ? 'text-primary fw-bold' : 'text-muted'}`;
  document.getElementById('modalDescCharCount').textContent = `${dLen} / 200`;
}

function renderKeywordPills(keywords = []) {
  const container = document.getElementById('modalKeywordsContainer');
  document.getElementById('modalKwCountBadge').textContent = `${keywords.length} / 49`;

  if (keywords.length === 0) {
    container.innerHTML = `<div class="text-muted small py-3 text-center w-100">Belum ada keyword.</div>`;
    return;
  }

  container.innerHTML = keywords.map((kw, idx) => `
    <span class="kw-pill ${idx < 10 ? 'top-ten' : ''}">
      <span class="kw-rank">#${idx + 1}</span>
      <span>${kw}</span>
      <button type="button" class="kw-remove-btn" data-kw-index="${idx}" title="Hapus keyword">&times;</button>
    </span>
  `).join('');
}

function syncActiveModalMetadata() {
  const item = state.items.find(i => i.id === state.activeItemId);
  if (!item) return null;

  if (!item.metadata) {
    item.metadata = { title: '', description: '', keywords: [], category: 'Graphic Resources', fictionalPeople: false };
  }
  item.metadata.title = document.getElementById('modalInputTitle').value.trim();
  item.metadata.description = document.getElementById('modalInputDesc').value.trim();
  item.metadata.category = document.getElementById('modalSelectCategory').value;
  item.metadata.fictionalPeople = document.getElementById('modalCheckFictional').checked;

  updateCharCounters(item.metadata.title, item.metadata.description);
  item.audit = auditAdobeCompliance(item);
  saveItemToDb(item);
  refreshStatsAndGrid();
  return item;
}

/**
 * Generates 3 AI-Style Sample Stock Assets on Canvas for immediate testing
 */
async function loadAiSampleAssets() {
  const samples = [
    {
      name: 'ai_geometric_owl_logo_illustration.png',
      width: 1400,
      height: 1000,
      draw(ctx, w, h) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        // Flat vector geometric owl badge
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, 310, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(w / 2 - 190, h / 2 - 220);
        ctx.lineTo(w / 2, h / 2 - 120);
        ctx.lineTo(w / 2 + 190, h / 2 - 220);
        ctx.lineTo(w / 2 + 150, h / 2 + 190);
        ctx.lineTo(w / 2, h / 2 + 250);
        ctx.lineTo(w / 2 - 150, h / 2 + 190);
        ctx.closePath();
        ctx.fill();

        // Eyes
        for (const dir of [-1, 1]) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(w / 2 + dir * 75, h / 2 - 35, 62, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(w / 2 + dir * 75, h / 2 - 35, 28, 0, Math.PI * 2);
          ctx.fill();
        }

        // Beak
        ctx.fillStyle = '#ea580c';
        ctx.beginPath();
        ctx.moveTo(w / 2 - 32, h / 2 + 15);
        ctx.lineTo(w / 2 + 32, h / 2 + 15);
        ctx.lineTo(w / 2, h / 2 + 85);
        ctx.closePath();
        ctx.fill();
      },
      meta: {
        title: 'Minimalist Geometric Owl Mascot Logo Emblem Illustration on White',
        description: 'Flat vector style geometric owl emblem icon with bold symmetry and vibrant warm orange palette for modern branding.',
        keywords: ['owl', 'logo', 'geometric', 'mascot', 'illustration', 'vector', 'emblem', 'bird', 'icon', 'minimalist', 'flat design', 'symbol', 'wildlife', 'wisdom', 'badge', 'modern', 'graphic', 'orange', 'branding', 'identity', 'clipart', 'sticker', 'isolated', 'animal', 'abstract', 'creative', 'head', 'character', 'sign', 'symmetric', 'art', 'clean'],
        category: 'Graphic Resources',
        fictionalPeople: false
      }
    },
    {
      name: 'ai_minimalist_cosmetic_podium_3d.jpg',
      width: 1600,
      height: 1066,
      draw(ctx, w, h) {
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#fde68a');
        grad.addColorStop(0.5, '#f5d0fe');
        grad.addColorStop(1, '#bae6fd');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Soft sun arch
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.58, 280, Math.PI, 0);
        ctx.fill();

        // 3D Cylinder Podium
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(w / 2 - 210, h * 0.58, 420, 220);
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.ellipse(w / 2, h * 0.58, 210, 42, 0, 0, Math.PI * 2);
        ctx.fill();
      },
      meta: {
        title: 'Minimalist Pastel 3D Cylinder Product Podium Stage in Soft Daylight',
        description: 'Clean contemporary 3D studio pedestal display platform with pastel gradient background and copy space for cosmetic advertising.',
        keywords: ['podium', 'pedestal', 'stage', 'product display', 'minimalist', 'pastel', 'background', '3d illustration', 'cylinder', 'platform', 'cosmetic', 'studio', 'showcase', 'stand', 'empty', 'copy space', 'modern', 'presentation', 'abstract', 'architecture', 'clean', 'light', 'luxury', 'mockup', 'advertising', 'commercial', 'geometric', 'soft', 'pink', 'beige', 'template', 'interior'],
        category: 'Graphic Resources',
        fictionalPeople: false
      }
    },
    {
      name: 'ai_futuristic_green_energy_city_landscape.jpg',
      width: 1600,
      height: 1000,
      draw(ctx, w, h) {
        const sky = ctx.createLinearGradient(0, 0, 0, h);
        sky.addColorStop(0, '#0284c7');
        sky.addColorStop(0.65, '#bae6fd');
        sky.addColorStop(1, '#10b981');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, h);

        // Mountains & solar towers
        ctx.fillStyle = '#047857';
        ctx.beginPath();
        ctx.moveTo(0, h * 0.72);
        ctx.quadraticCurveTo(w * 0.28, h * 0.48, w * 0.55, h * 0.7);
        ctx.quadraticCurveTo(w * 0.8, h * 0.52, w, h * 0.68);
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();

        // Futuristic eco towers
        ctx.fillStyle = '#f8fafc';
        const towers = [[380, 360, 90, 340], [520, 300, 110, 400], [680, 390, 85, 310], [1050, 340, 95, 360]];
        for (const [tx, ty, tw, th] of towers) {
          ctx.fillRect(tx, ty, tw, th);
        }
      },
      meta: {
        title: 'Futuristic Sustainable Green Smart City Skyline with Lush Nature',
        description: 'Eco friendly futuristic urban architecture integrated with green hills and clean renewable energy under bright blue sky.',
        keywords: ['smart city', 'sustainable', 'eco friendly', 'futuristic', 'green energy', 'architecture', 'environment', 'ecology', 'urban', 'nature', 'innovation', 'clean energy', 'skyline', 'building', 'future', 'landscape', 'sustainability', 'technology', 'modern', 'renewable', 'solar', 'harmony', 'metropolis', 'concept', 'utopia', 'green', 'sky', 'outdoor', 'development', 'planet', 'climate'],
        category: 'The Environment',
        fictionalPeople: false
      }
    }
  ];

  for (const s of samples) {
    const canvas = document.createElement('canvas');
    canvas.width = s.width;
    canvas.height = s.height;
    const ctx = canvas.getContext('2d');
    s.draw(ctx, s.width, s.height);

    const mime = s.name.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(r => canvas.toBlob(r, mime, 0.94));
    const file = new File([blob], s.name, { type: mime });
    const url = URL.createObjectURL(blob);
    const mp = (s.width * s.height) / 1e6;

    const item = {
      id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: s.name,
      originalWidth: s.width,
      originalHeight: s.height,
      originalMegapixels: mp,
      originalSize: blob.size,
      previewUrl: url,
      status: 'waiting',
      stepText: '',
      metadata: { ...s.meta, isAiGenerated: true }
    };
    item.audit = auditAdobeCompliance(item);
    state.items.push(item);
    await saveItemToDb(item);
  }

  refreshStatsAndGrid();
  showToast('3 Sampel AI Dimuat', 'Klik "Proses Semua", "Upscale", atau "SVG" untuk mencoba fitur.', 'success');
}

/**
 * Initialize Event Listeners
 */
document.addEventListener('DOMContentLoaded', () => {
  inspectModalInstance = new bootstrap.Modal(document.getElementById('inspectModal'));
  apiKeyModalInstance = new bootstrap.Modal(document.getElementById('apiKeyModal'));
  exportModalInstance = new bootstrap.Modal(document.getElementById('exportModal'));
  guideModalInstance = new bootstrap.Modal(document.getElementById('guideModal'));

  populateCategoryDropdown();
  updateApiKeyBanner();
  refreshStatsAndGrid();
  restoreQueueFromDb();
  renderNicheCards();

  window.addEventListener('gemini-usage-updated', updateApiKeyBanner);

  // Full-Page Navigation Switcher (Studio Gambar vs Niche & Prompt)
  const switchMainPage = targetPage => {
    const isNiche = targetPage === 'niche';
    document.getElementById('viewStudio').classList.toggle('d-none', isNiche);
    document.getElementById('viewNiche').classList.toggle('d-none', !isNiche);
    document.querySelectorAll('#mainPageSwitch .nav-page-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === targetPage);
    });
    if (isNiche) {
      renderNicheCards();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  document.getElementById('mainPageSwitch').addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn) return;
    switchMainPage(btn.dataset.page);
  });

  // Populate Niche Month Dropdown
  const monthSel = document.getElementById('selectNicheBaseMonth');
  if (monthSel) {
    monthSel.innerHTML = MONTH_NAMES_ID.map((m, idx) => `<option value="${idx}" ${idx === nicheState.baseMonth ? 'selected' : ''}>${m}</option>`).join('');
    monthSel.addEventListener('change', e => {
      nicheState.baseMonth = parseInt(e.target.value, 10);
      renderNicheCards();
    });
  }

  document.getElementById('nicheHorizonGroup').addEventListener('click', e => {
    const btn = e.target.closest('[data-horizon]');
    if (!btn) return;
    document.querySelectorAll('#nicheHorizonGroup button').forEach(b => {
      b.className = 'btn btn-sm btn-outline-secondary bg-white';
    });
    btn.className = 'btn btn-sm btn-dark active';
    nicheState.horizon = btn.dataset.horizon;
    renderNicheCards();
  });

  document.getElementById('btnGenerateCustomPrompt').addEventListener('click', async () => {
    const input = document.getElementById('inputCustomNicheTopic');
    const topic = input.value.trim();
    if (!topic) {
      showToast('Masukkan Topik', 'Ketik topik atau event yang ingin dibuatkan prompt Google Flow.', 'warning');
      return;
    }
    const btn = document.getElementById('btnGenerateCustomPrompt');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Membuat...';
    try {
      const customCard = await generateCustomFlowPrompts(topic, 'Sesuai Tren & Musiman', state.settings.preferredModel);
      nicheState.customNiches.unshift(customCard);
      input.value = '';
      renderNicheCards();
      showToast('Prompt Siap', `3 variasi prompt Google Flow untuk "${topic}" berhasil dibuat.`, 'success');
    } catch (err) {
      showToast('Gagal Membuat Prompt', err.message, 'danger');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  });

  document.getElementById('inputCustomNicheTopic').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btnGenerateCustomPrompt').click();
    }
  });

  document.getElementById('nicheCardsContainer').addEventListener('click', e => {
    const shuffleBtn = e.target.closest('[data-shuffle-niche]');
    if (shuffleBtn) {
      const id = shuffleBtn.dataset.shuffleNiche;
      nicheState.seedMap[id] = (nicheState.seedMap[id] || 0) + 1;
      renderNicheCards();
      return;
    }

    const copyBtn = e.target.closest('[data-copy-prompt]');
    if (copyBtn) {
      const promptText = decodeURIComponent(copyBtn.dataset.copyPrompt);
      navigator.clipboard.writeText(promptText);
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Tersalin!';
      setTimeout(() => { copyBtn.textContent = prev; }, 1500);
      showToast('Prompt Disalin', 'Silakan tempel (paste) ke Google Flow / ImageFX.', 'success');
      return;
    }

    const applyBtn = e.target.closest('[data-apply-theme]');
    if (applyBtn) {
      const theme = decodeURIComponent(applyBtn.dataset.applyTheme);
      state.settings.focusTheme = theme;
      const inputTheme = document.getElementById('inputFocusTheme');
      if (inputTheme) inputTheme.value = theme;
      switchMainPage('studio');
      const metaTabBtn = document.querySelector('[data-bs-target="#tabVision"]');
      if (metaTabBtn) bootstrap.Tab.getOrCreateInstance(metaTabBtn).show();
      showToast('Tema Diterapkan', `Tema "${theme}" diterapkan ke pengaturan Metadata AI.`, 'success');
    }
  });

  // Header Buttons
  document.getElementById('btnOpenApiModal').addEventListener('click', () => {
    document.getElementById('inputGeminiKeys').value = localStorage.getItem('adobe_helper_gemini_keys') || '';
    document.getElementById('selectGeminiModel').value = state.settings.preferredModel;
    document.getElementById('apiTestResultBox').classList.add('d-none');
    updateApiKeyBanner();
    apiKeyModalInstance.show();
  });
  document.getElementById('btnAlertOpenKey').addEventListener('click', () => {
    document.getElementById('btnOpenApiModal').click();
  });
  document.getElementById('btnOpenGuideModal').addEventListener('click', () => guideModalInstance.show());
  document.getElementById('btnOpenExportModal').addEventListener('click', () => {
    if (state.items.length === 0) {
      showToast('Antrean Kosong', 'Tambahkan minimal 1 gambar terlebih dahulu.', 'warning');
      return;
    }
    exportModalInstance.show();
  });

  // Save & Test API Key
  document.getElementById('btnSaveApiKey').addEventListener('click', () => {
    const keys = document.getElementById('inputGeminiKeys').value.trim();
    const model = document.getElementById('selectGeminiModel').value;
    localStorage.setItem('adobe_helper_gemini_keys', keys);
    localStorage.setItem('adobe_helper_gemini_model', model);
    state.settings.preferredModel = model;
    updateApiKeyBanner();
    apiKeyModalInstance.hide();
    showToast('API Key Disimpan', 'Konfigurasi Gemini Vision berhasil disimpan di browser.', 'success');
  });

  document.getElementById('btnTestApiKey').addEventListener('click', async () => {
    const raw = document.getElementById('inputGeminiKeys').value.trim();
    const firstKey = raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)[0];
    let model = document.getElementById('selectGeminiModel').value || 'gemini-3.8-flash';
    const box = document.getElementById('apiTestResultBox');
    box.classList.remove('d-none');

    if (!firstKey) {
      box.className = 'small p-2 rounded-2 bg-light-danger';
      box.textContent = 'Masukkan minimal 1 API Key terlebih dahulu.';
      return;
    }

    box.className = 'small p-2 rounded-2 bg-light-info';
    box.textContent = `Menghubungi server Google Gemini (${model})...`;

    const tryGenerate = async (targetModel) => {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${encodeURIComponent(firstKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with OK' }] }]
        })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${resp.status}`);
      }
      return targetModel;
    };

    try {
      let activeModel = model;
      try {
        activeModel = await tryGenerate(model);
      } catch (firstErr) {
        // Check if error message recommends a newer model (e.g. models/gemini-3.8-flash)
        const match = String(firstErr.message || '').match(/use models\/([a-zA-Z0-9._-]+)/i);
        let candidates = [];
        if (match?.[1]) candidates.push(match[1]);
        if (model !== 'gemini-3.8-flash') candidates.push('gemini-3.8-flash');
        const discovered = await discoverAvailableVisionModels(firstKey);
        for (const dm of discovered) {
          if (!candidates.includes(dm) && dm !== model) candidates.push(dm);
        }

        let succeeded = null;
        for (const cand of candidates) {
          try {
            succeeded = await tryGenerate(cand);
            break;
          } catch {}
        }

        if (succeeded) {
          activeModel = succeeded;
          const sel = document.getElementById('selectGeminiModel');
          if (![...sel.options].some(o => o.value === activeModel)) {
            const opt = document.createElement('option');
            opt.value = activeModel;
            opt.textContent = `${activeModel} (Auto-Detected)`;
            sel.prepend(opt);
          }
          sel.value = activeModel;
          state.settings.preferredModel = activeModel;
          localStorage.setItem('adobe_helper_gemini_model', activeModel);
        } else {
          throw firstErr;
        }
      }

      box.className = 'small p-2 rounded-2 bg-light-success fw-semibold';
      box.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i>Koneksi Berhasil! Model <code>${activeModel}</code> aktif dan siap menganalisis gambar Anda.`;
    } catch (e) {
      box.className = 'small p-2 rounded-2 bg-light-danger';
      box.textContent = `Gagal: ${e.message}`;
    }
  });

  // Upload Dropzone
  const dropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('fileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    if (e.target.files?.length) {
      handleFilesAdded(e.target.files);
      e.target.value = '';
    }
  });
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('drag-active');
  });
  dropzone.addEventListener('dragleave', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-active');
  });
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-active');
    if (e.dataTransfer?.files?.length) {
      handleFilesAdded(e.dataTransfer.files);
    }
  });

  // Sample Buttons
  document.getElementById('btnLoadSamples').addEventListener('click', loadAiSampleAssets);
  document.getElementById('btnEmptyLoadSamples').addEventListener('click', loadAiSampleAssets);

  // Settings Sidebar Controls
  document.getElementById('scalePresetGroup').addEventListener('click', e => {
    const btn = e.target.closest('[data-scale]');
    if (!btn) return;
    document.querySelectorAll('#scalePresetGroup .preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.settings.targetScale = btn.dataset.scale;
  });

  document.getElementById('selectUpscaleProfile').addEventListener('change', e => {
    state.settings.profile = e.target.value;
  });

  document.getElementById('rangeSharpness').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('labelSharpnessVal').textContent = `${val}%`;
    state.settings.sharpness = val / 100;
  });

  document.getElementById('selectOutputFormat').addEventListener('change', e => {
    state.settings.outputFormat = e.target.value;
  });

  document.getElementById('selectJpegQuality').addEventListener('change', e => {
    state.settings.jpegQuality = parseInt(e.target.value, 10);
  });

  document.getElementById('rangeVectorColors').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('labelVectorColors').textContent = `${val} Warna`;
    state.settings.vectorColors = val;
  });

  document.getElementById('rangeSpeckleArea').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('labelSpeckleArea').textContent = `${val} px`;
    state.settings.minSpeckleArea = val;
  });

  document.getElementById('checkAutoIsolateBg').addEventListener('change', e => {
    state.settings.autoIsolateBg = e.target.checked;
    document.getElementById('bgToleranceBox').classList.toggle('d-none', !e.target.checked);
  });

  document.getElementById('rangeBgTolerance').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('labelBgTolerance').textContent = `${val}%`;
    state.settings.bgTolerance = val;
  });

  document.getElementById('selectBgMode').addEventListener('change', e => {
    state.settings.bgMode = e.target.value;
  });

  document.getElementById('rangeKeywordCount').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('labelKeywordCount').textContent = `${val} tags`;
    state.settings.keywordCount = val;
  });

  document.getElementById('selectAssetStyle').addEventListener('change', e => {
    state.settings.assetStyle = e.target.value;
  });

  document.getElementById('inputFocusTheme').addEventListener('input', e => {
    state.settings.focusTheme = e.target.value;
  });

  // Batch Buttons
  document.getElementById('btnBatchProcessAll').addEventListener('click', () => {
    if (state.items.length === 0) return;
    runBatchQueue(
      state.items,
      async item => {
        if (!item.upscaledBlob) await runSingleUpscale(item);
        const hasKey = (localStorage.getItem('adobe_helper_gemini_keys') || '').trim().length > 10;
        if (hasKey) await runSingleVisionMeta(item);
      },
      'Upscale + Vision AI'
    );
  });

  document.getElementById('btnBatchUpscaleOnly').addEventListener('click', () => {
    if (state.items.length === 0) return;
    runBatchQueue(state.items, item => runSingleUpscale(item), 'Batch Upscaling');
  });

  document.getElementById('btnBatchMetaOnly').addEventListener('click', () => {
    if (state.items.length === 0) return;
    runBatchQueue(state.items, item => runSingleVisionMeta(item), 'Gemini Vision Metadata');
  });

  document.getElementById('btnBatchVectorize').addEventListener('click', () => {
    if (state.items.length === 0) return;
    runBatchQueue(state.items, item => runSingleVectorize(item), 'Tracing Vector SVG/EPS');
  });

  document.getElementById('btnClearQueue').addEventListener('click', () => {
    if (state.items.length === 0) return;
    if (confirm('Hapus semua gambar dari daftar antrean?')) {
      state.items = [];
      state.activeItemId = null;
      clearQueueDb();
      refreshStatsAndGrid();
    }
  });

  // Filter & Search
  document.getElementById('filterPillsGroup').addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    document.querySelectorAll('#filterPillsGroup button').forEach(b => {
      b.className = 'btn btn-sm btn-outline-secondary text-nowrap';
    });
    btn.className = 'btn btn-sm btn-dark active text-nowrap';
    state.activeFilter = btn.dataset.filter;
    refreshStatsAndGrid();
  });

  document.getElementById('inputSearchFilter').addEventListener('input', e => {
    state.searchQuery = e.target.value;
    refreshStatsAndGrid();
  });

  // Grid Card Delegated Actions
  document.getElementById('assetsGrid').addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    if (action === 'inspect') openInspectModal(id);
    else if (action === 'upscale') runSingleUpscale(item);
    else if (action === 'meta') runSingleVisionMeta(item);
    else if (action === 'vector') runSingleVectorize(item);
    else if (action === 'split4') runSingleSplitFour(item);
    else if (action === 'download') downloadSingleAsset(item, true);
    else if (action === 'download-svg') downloadSvgAsset(item);
    else if (action === 'download-eps') downloadEpsAsset(item);
    else if (action === 'remove') {
      state.items = state.items.filter(i => i.id !== id);
      deleteItemFromDb(id);
      refreshStatsAndGrid();
    }
  });

  // Inspect Modal Interactive Split Slider
  const compareStage = document.getElementById('compareStage');
  const compareClip = document.getElementById('compareClip');
  const compareBeforeInner = document.getElementById('compareBeforeInner');
  let isSliding = false;

  const updateSliderPos = clientX => {
    const rect = compareStage.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const pct = (x / rect.width) * 100;
    compareClip.style.width = `${pct}%`;
    compareBeforeInner.style.width = `${rect.width}px`;
  };

  compareStage.addEventListener('mousedown', e => {
    isSliding = true;
    updateSliderPos(e.clientX);
  });
  window.addEventListener('mousemove', e => {
    if (isSliding) updateSliderPos(e.clientX);
  });
  window.addEventListener('mouseup', () => {
    isSliding = false;
  });
  compareStage.addEventListener('touchstart', e => {
    isSliding = true;
    updateSliderPos(e.touches[0].clientX);
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (isSliding && e.touches[0]) updateSliderPos(e.touches[0].clientX);
  }, { passive: true });
  window.addEventListener('touchend', () => {
    isSliding = false;
  });

  // Inspect Modal Navigation Buttons (Header & Stage Overlay)
  const btnModalPrev = document.getElementById('btnModalPrev');
  const btnModalNext = document.getElementById('btnModalNext');
  const btnStagePrev = document.getElementById('btnStagePrev');
  const btnStageNext = document.getElementById('btnStageNext');

  if (btnModalPrev) {
    btnModalPrev.addEventListener('click', () => navigateInspectModal(-1));
  }
  if (btnModalNext) {
    btnModalNext.addEventListener('click', () => navigateInspectModal(1));
  }
  if (btnStagePrev) {
    btnStagePrev.addEventListener('click', e => {
      e.stopPropagation();
      navigateInspectModal(-1);
    });
    ['mousedown', 'touchstart', 'pointerdown'].forEach(evt => {
      btnStagePrev.addEventListener(evt, e => e.stopPropagation());
    });
  }
  if (btnStageNext) {
    btnStageNext.addEventListener('click', e => {
      e.stopPropagation();
      navigateInspectModal(1);
    });
    ['mousedown', 'touchstart', 'pointerdown'].forEach(evt => {
      btnStageNext.addEventListener(evt, e => e.stopPropagation());
    });
  }

  // Keyboard navigation for inspect modal (Left & Right Arrow keys)
  window.addEventListener('keydown', e => {
    const inspectModalEl = document.getElementById('inspectModal');
    if (!inspectModalEl || !inspectModalEl.classList.contains('show')) return;

    const activeEl = document.activeElement;
    const isInput = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.tagName === 'SELECT' ||
      activeEl.isContentEditable
    );
    if (isInput) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateInspectModal(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateInspectModal(1);
    }
  });

  const inspectModalEl = document.getElementById('inspectModal');
  if (inspectModalEl) {
    inspectModalEl.addEventListener('shown.bs.modal', () => {
      const cStage = document.getElementById('compareStage');
      const cBefore = document.getElementById('compareBeforeInner');
      if (cStage && cBefore) {
        cBefore.style.width = `${cStage.offsetWidth}px`;
      }
    });
    inspectModalEl.addEventListener('hidden.bs.modal', () => {
      syncActiveModalMetadata();
      resetZoom();
    });
  }

  window.addEventListener('resize', () => {
    const cStage = document.getElementById('compareStage');
    const cBefore = document.getElementById('compareBeforeInner');
    if (cStage && cBefore && cStage.offsetWidth > 0) {
      cBefore.style.width = `${cStage.offsetWidth}px`;
    }
  });

  // Inspect Modal View Mode & Zoom
  document.getElementById('btnViewRasterMode').addEventListener('click', () => {
    state.compareViewMode = 'raster';
    const item = state.items.find(i => i.id === state.activeItemId);
    if (item) renderInspectModal(item);
  });

  document.getElementById('btnViewVectorMode').addEventListener('click', () => {
    const item = state.items.find(i => i.id === state.activeItemId);
    if (!item) return;
    if (!item.isVectorized) {
      runSingleVectorize(item);
    } else {
      state.compareViewMode = 'vector';
      renderInspectModal(item);
    }
  });

  document.getElementById('zoomBtnGroup').addEventListener('click', e => {
    const btn = e.target.closest('[data-zoom]');
    if (!btn) return;
    document.querySelectorAll('#zoomBtnGroup button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const z = parseFloat(btn.dataset.zoom);
    document.getElementById('compareBeforeImg').style.transform = `scale(${z})`;
    document.getElementById('compareAfterImg').style.transform = `scale(${z})`;
  });

  // Inspect Modal Action Buttons
  document.getElementById('btnModalUpscale').addEventListener('click', () => {
    const item = state.items.find(i => i.id === state.activeItemId);
    if (item) runSingleUpscale(item);
  });

  document.getElementById('btnModalGenerateMeta').addEventListener('click', () => {
    const item = state.items.find(i => i.id === state.activeItemId);
    if (item) runSingleVisionMeta(item);
  });

  document.getElementById('btnModalIsolateBg').addEventListener('click', async () => {
    const item = state.items.find(i => i.id === state.activeItemId);
    if (!item) return;
    try {
      const iso = await isolateSubjectBackground(item.upscaledUrl || item.previewUrl, {
        tolerance: state.settings.bgTolerance,
        fillWhite: state.settings.bgMode === 'white'
      });
      item.isIsolated = true;
      item.isolatedBlob = iso.blob;
      item.isolatedUrl = iso.url;
      item.upscaledBlob = iso.blob;
      item.upscaledUrl = iso.url;
      item.upscaledSize = iso.blob.size;
      item.exportExt = iso.isTransparent ? '.png' : '.jpg';
      await saveItemToDb(item);
      renderInspectModal(item);
      refreshStatsAndGrid();
      showToast('Background Dihapus', 'Subjek utama berhasil diisolasi.', 'success');
    } catch (err) {
      showToast('Gagal Hapus Background', err.message, 'danger');
    }
  });

  document.getElementById('btnModalVectorize').addEventListener('click', () => {
    const item = state.items.find(i => i.id === state.activeItemId);
    if (item) runSingleVectorize(item);
  });

  document.getElementById('btnModalSplit4').addEventListener('click', () => {
    const item = state.items.find(i => i.id === state.activeItemId);
    if (item) runSingleSplitFour(item);
  });

  document.getElementById('btnDownloadSvg').addEventListener('click', () => {
    const item = state.items.find(i => String(i.id) === String(state.activeItemId));
    if (item) downloadSvgAsset(item);
  });

  document.getElementById('btnDownloadEps').addEventListener('click', () => {
    const item = state.items.find(i => String(i.id) === String(state.activeItemId));
    if (item) downloadEpsAsset(item);
  });

  // Metadata Live Editing in Modal
  ['modalInputTitle', 'modalInputDesc', 'modalSelectCategory', 'modalCheckFictional'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const item = syncActiveModalMetadata();
      if (item) {
        document.getElementById('modalQcScoreBadge').textContent = `Skor QC: ${item.audit.score}/100`;
      }
    });
  });

  document.getElementById('btnModalAddKw').addEventListener('click', () => {
    const item = state.items.find(i => i.id === state.activeItemId);
    if (!item) return;
    const input = document.getElementById('modalInputAddKw');
    const raw = input.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (raw.length === 0) return;

    if (!item.metadata) {
      item.metadata = { title: '', description: '', keywords: [], category: 'Graphic Resources' };
    }
    item.metadata.keywords = Array.from(new Set([...(item.metadata.keywords || []), ...raw])).slice(0, 49);
    input.value = '';
    renderKeywordPills(item.metadata.keywords);
    syncActiveModalMetadata();
  });

  document.getElementById('modalInputAddKw').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btnModalAddKw').click();
    }
  });

  document.getElementById('modalKeywordsContainer').addEventListener('click', e => {
    const btn = e.target.closest('[data-kw-index]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.kwIndex, 10);
    const item = state.items.find(i => i.id === state.activeItemId);
    if (!item?.metadata?.keywords) return;
    item.metadata.keywords.splice(idx, 1);
    renderKeywordPills(item.metadata.keywords);
    syncActiveModalMetadata();
  });

  document.getElementById('btnCopyKeywords').addEventListener('click', () => {
    const item = state.items.find(i => i.id === state.activeItemId);
    const kws = item?.metadata?.keywords || [];
    if (kws.length === 0) return;
    navigator.clipboard.writeText(kws.join(', '));
    showToast('Keywords Disalin', `${kws.length} kata kunci disalin ke clipboard.`, 'success');
  });

  document.getElementById('btnScrubKeywords').addEventListener('click', () => {
    const item = state.items.find(i => i.id === state.activeItemId);
    if (!item?.metadata) return;
    item.metadata.title = sanitizeAdobeTitle(item.metadata.title);
    item.metadata.keywords = sanitizeAdobeKeywords(
      item.metadata.keywords,
      item.metadata.title,
      state.settings.keywordCount,
      item.isVectorized
    );
    renderInspectModal(item);
    refreshStatsAndGrid();
    showToast('Metadata Dibersihkan', 'Trademark, istilah teknis terlarang, dan duplikat telah dihapus.', 'success');
  });

  document.getElementById('btnModalDownloadAsset').addEventListener('click', () => {
    const item = syncActiveModalMetadata();
    if (!item) return;
    const embedXmp = document.getElementById('modalCheckEmbedXmp').checked;
    downloadSingleAsset(item, embedXmp);
  });

  // Export Modal Events
  document.getElementById('exportAgencyGroup').addEventListener('click', e => {
    const btn = e.target.closest('[data-agency]');
    if (!btn) return;
    document.querySelectorAll('#exportAgencyGroup .preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.exportAgency = btn.dataset.agency;
  });

  document.getElementById('btnExportCsvOnly').addEventListener('click', () => {
    const csvContent = generateAgencyCsv(state.items, state.exportAgency);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metadata_${state.exportAgency}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV Diunduh', `File CSV format ${state.exportAgency.toUpperCase()} berhasil disimpan.`, 'success');
  });

  document.getElementById('btnExportFullZip').addEventListener('click', async () => {
    if (state.items.length === 0 || typeof JSZip === 'undefined') return;

    const embedXmp = document.getElementById('exportCheckXmp').checked;
    const includeVectors = document.getElementById('exportCheckVectors').checked;
    const includeCsv = document.getElementById('exportCheckCsv').checked;

    const progBox = document.getElementById('zipBuildProgressBox');
    const progPct = document.getElementById('zipBuildPercent');
    const progBar = document.getElementById('zipBuildBar');
    progBox.classList.remove('d-none');

    try {
      const zip = new JSZip();
      const folder = zip.folder(`adobe_stock_batch_${new Date().toISOString().slice(0, 10)}`) || zip;

      for (let i = 0; i < state.items.length; i++) {
        const item = state.items[i];
        const baseName = item.name.replace(/\.[^/.]+$/, '');
        let blob = item.upscaledBlob || item.isolatedBlob || item.file;

        if (embedXmp && item.metadata && item.metadata.title) {
          blob = await embedMetadataIntoBlob(blob, item.metadata);
        }

        const ext = blob.type === 'image/png' ? '.png' : '.jpg';
        item.exportExt = ext;
        const outFilename = getExportFilename(item);
        const arrBuf = await blob.arrayBuffer();
        folder.file(outFilename, arrBuf);

        if (includeVectors && item.isVectorized) {
          if (item.svgString) folder.file(`${baseName}_vector.svg`, item.svgString);
          if (item.epsString) folder.file(`${baseName}_vector.eps`, item.epsString);
        }

        const pct = Math.round(((i + 1) / state.items.length) * 80);
        progPct.textContent = `${pct}%`;
        progBar.style.width = `${pct}%`;
      }

      if (includeCsv) {
        const csvContent = generateAgencyCsv(state.items, state.exportAgency);
        folder.file(`metadata_${state.exportAgency}.csv`, csvContent);
      }

      const zipBlob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } },
        meta => {
          const p = 80 + Math.round((meta.percent / 100) * 20);
          progPct.textContent = `${p}%`;
          progBar.style.width = `${p}%`;
        }
      );

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `microstock_${state.exportAgency}_package_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      progBox.classList.add('d-none');
      exportModalInstance.hide();
      showToast('Paket ZIP Berhasil Diunduh', 'Semua gambar (XMP Embedded), Vector SVG/EPS, dan CSV telah dikemas.', 'success');
    } catch (err) {
      progBox.classList.add('d-none');
      showToast('Gagal Membuat ZIP', err.message, 'danger');
    }
  });
});

