/**
 * Real Multimodal Gemini Vision Metadata Engine + Adobe Stock Anti-Reject Sanitizer
 * Analyzes actual image pixels (NEVER guesses from camera filenames like IMG_1234.jpg)
 */

import { ADOBE_CATEGORIES } from './xmp-exporter.js';

export const BANNED_BRANDS = [
  'apple', 'iphone', 'ipad', 'macbook', 'imac', 'airpods', 'ios',
  'samsung', 'galaxy', 'sony', 'playstation', 'ps4', 'ps5', 'xbox',
  'microsoft', 'windows', 'google', 'android', 'pixel',
  'nike', 'adidas', 'puma', 'reebok', 'converse', 'vans', 'gucci', 'prada', 'chanel', 'louis vuitton', 'rolex', 'omega', 'casio',
  'canon', 'nikon', 'fujifilm', 'leica', 'panasonic', 'lumix', 'gopro', 'hasselblad',
  'tesla', 'ferrari', 'lamborghini', 'porsche', 'bmw', 'mercedes', 'audi', 'toyota', 'honda', 'ford',
  'disney', 'marvel', 'pixar', 'pokemon', 'nintendo', 'lego', 'barbie', 'mattel',
  'coca cola', 'coca-cola', 'pepsi', 'starbucks', 'mcdonalds', 'kfc', 'nutella',
  'instagram', 'facebook', 'meta', 'tiktok', 'youtube', 'whatsapp', 'twitter', 'linkedin', 'netflix',
  'midjourney', 'dall-e', 'dalle', 'stable diffusion', 'sdxl', 'flux', 'leonardo ai', 'adobe firefly', 'unreal engine', 'octane render', 'v-ray', 'blender'
];

export const BANNED_BUZZWORDS = [
  '4k', '8k', '12k', '16k', 'uhd', 'ultra hd', 'full hd', '1080p',
  'wallpaper', 'screen saver', 'screensaver',
  'photorealistic', 'hyperrealistic', 'ultra realistic', 'masterpiece', 'award winning', 'best quality', 'high quality', 'high resolution', 'trending on artstation',
  'dslr', 'iso 100', '85mm', '50mm', '35mm', 'f1.4', 'f1.8', 'shutter speed', 'aperture', 'raw photo',
  'royalty free', 'royalty-free', 'stock photo', 'stock image', 'microstock', 'copyright',
  'ai generated', 'generative ai', 'prompt'
];

/**
 * Creates a compact 800px base64 JPEG from an image source for fast Vision API transfer
 */
export async function createVisionThumbnailBase64(imageItem, maxDim = 800) {
  const src = imageItem.upscaledUrl || imageItem.previewUrl;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width || 800;
      let h = img.naturalHeight || img.height || 600;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
      const base64 = dataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
      resolve({ base64, mimeType: 'image/jpeg' });
    };
    img.onerror = () => reject(new Error('Gagal membaca gambar untuk analisis Vision AI.'));
    img.src = src;
  });
}

/**
 * Scrubs banned trademarks & spam terms from a title and enforces 50-70 char commercial length
 */
export function sanitizeAdobeTitle(rawTitle = '') {
  let title = String(rawTitle || '').trim();
  for (const term of [...BANNED_BRANDS, ...BANNED_BUZZWORDS]) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
  }
  title = title
    .replace(/["'“”‘’`]/g, '')
    .replace(/\s*[,;:|/\\]+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.\s*$/, '')
    .trim();

  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  // Truncate cleanly at word boundary if > 75 chars
  if (title.length > 75) {
    const sub = title.substring(0, 72);
    const lastSpace = sub.lastIndexOf(' ');
    title = lastSpace > 45 ? sub.substring(0, lastSpace).trim() : sub.trim();
    title = title.replace(/\s+(in|on|at|with|for|and|or|of|the|a|an|to|by)$/i, '').trim();
  }

  return title;
}

/**
 * Scrubs, deduplicates, and orders keywords (max 49 for Adobe Stock)
 * Ensures Top 10 keywords contain core subject words from Title
 */
export function sanitizeAdobeKeywords(rawKeywords = [], title = '', maxCount = 45, isVector = false) {
  const seen = new Set();
  const cleanList = [];

  const isBanned = (kw) => {
    const lower = kw.toLowerCase();
    for (const b of [...BANNED_BRANDS, ...BANNED_BUZZWORDS]) {
      if (lower === b || new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
        return true;
      }
    }
    return false;
  };

  const addKeyword = (word) => {
    const w = String(word || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!w || w.length < 2 || w.length > 35) return;
    if (/^\d+$/.test(w)) return;
    if (seen.has(w) || isBanned(w)) return;
    seen.add(w);
    cleanList.push(w);
  };

  // 1. First, trust AI's top ranked keywords
  for (const kw of rawKeywords) {
    addKeyword(kw);
  }

  // 2. Ensure core nouns from Title are present
  const stopWords = new Set(['with', 'from', 'that', 'this', 'into', 'over', 'under', 'above', 'below', 'between', 'through', 'during', 'before', 'after', 'and', 'for', 'the', 'in', 'on', 'at', 'of', 'to', 'by']);
  const titleWords = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stopWords.has(w));

  for (const tw of titleWords) {
    addKeyword(tw);
  }

  if (isVector) {
    ['vector', 'illustration', 'graphic', 'design', 'scalable', 'flat', 'element', 'clipart'].forEach(addKeyword);
  }

  const limit = Math.min(49, Math.max(25, maxCount));
  return cleanList.slice(0, limit);
}

/**
 * Queries the Google Gemini API for models available to this API key that support generateContent
 */
export async function discoverAvailableVisionModels(apiKey) {
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    const list = (data.models || [])
      .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => String(m.name || '').replace(/^models\//, ''))
      .filter(name => name.startsWith('gemini-') && !name.includes('embedding') && !name.includes('tts') && !name.includes('imagen'));

    // Sort so latest flash models come first
    list.sort((a, b) => {
      const aFlash = a.includes('flash') ? 0 : 1;
      const bFlash = b.includes('flash') ? 0 : 1;
      if (aFlash !== bFlash) return aFlash - bFlash;
      return b.localeCompare(a);
    });
    return list;
  } catch {
    return [];
  }
}

/**
 * Calls Google Gemini Multimodal Vision API to analyze the actual image
 */
export async function analyzeImageWithGemini(imageItem, settings = {}) {
  const apiKeysRaw = settings.apiKeys || localStorage.getItem('adobe_helper_gemini_keys') || '';
  const keys = apiKeysRaw
    .split(/[\n,;]+/)
    .map(k => k.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new Error('API_KEY_MISSING: Silakan masukkan API Key Google Gemini (Gratis di aistudio.google.com) pada menu Pengaturan API Key terlebih dahulu.');
  }

  const { base64, mimeType } = await createVisionThumbnailBase64(imageItem, 800);
  const keywordCount = Math.min(49, Math.max(25, settings.keywordCount || 42));
  const isVector = Boolean(settings.isVector || imageItem.isVectorized);
  const assetStyle = settings.assetStyle || 'ai-auto'; // 'ai-auto' | 'ai-photo' | 'ai-illustration' | 'ai-vector'
  const customHint = (settings.focusTheme || '').trim();

  const categoryNames = ADOBE_CATEGORIES.map(c => c.name).join(', ');

  const systemPrompt = `You are a Senior Adobe Stock Contributor & Microstock SEO Curator.
Analyze the attached image visually with 100% accuracy. DO NOT guess from filenames.

CRITICAL ADOBE STOCK ANTI-REJECTION RULES:
1. TITLE:
   - Write a natural, descriptive English commercial title between 50 and 70 characters.
   - Describe the exact visual subject, action/setting, style, and lighting/mood.
   - NEVER include brand names/trademarks (Apple, Nike, Sony, Disney, etc.).
   - NEVER include camera specs or AI spam words (4K, 8K, DSLR, photorealistic, hyperrealistic, masterpiece, wallpaper, Midjourney, AI generated).
2. DESCRIPTION:
   - 1 to 2 clear commercial English sentences (100-180 characters) describing the visual content and commercial use case.
3. KEYWORDS (Generate ${keywordCount} single-word or 2-word English tags):
   - ORDER BY IMPORTANCE! The FIRST 10 KEYWORDS are the most important for Adobe Stock search algorithm and MUST literally describe the main visual subject, style, and core concept shown in the image.
   - Keywords #11 to #${keywordCount} should cover composition, mood, color palette, background type (e.g. copy space, isolated, studio), and commercial concepts.
   - All lowercase, no trademarks, no technical spam (no 4k, 8k, hd, wallpaper, photorealistic).
   ${isVector || assetStyle === 'ai-vector' ? '- Include relevant vector/illustration tags (vector, illustration, graphic, flat design, icon, clipart).' : ''}
4. CATEGORY:
   - Pick the single most accurate category from this exact list: ${categoryNames}.
5. FICTIONAL PEOPLE / RELEASE CHECK:
   - Set "fictionalPeople" to true if a recognizable human face/person is visible in the image (on Adobe Stock Generative AI, this reminds the contributor to check "People and Property are fictional").
6. VECTOR SUITABILITY:
   - Set "suitableForVector" to true if the image is a flat illustration, icon, logo, silhouette, line art, or sticker with distinct color regions; false if it is a complex photorealistic scene or 3D render with smooth photographic gradients.
${customHint ? `\nUSER CONTEXT / FOCUS HINT: "${customHint}" (incorporate only if visually consistent with the image).` : ''}`;

  const responseSchema = {
    type: 'OBJECT',
    properties: {
      title: { type: 'STRING' },
      description: { type: 'STRING' },
      keywords: {
        type: 'ARRAY',
        items: { type: 'STRING' }
      },
      category: { type: 'STRING' },
      fictionalPeople: { type: 'BOOLEAN' },
      suitableForVector: { type: 'BOOLEAN' },
      visualSummary: { type: 'STRING' }
    },
    required: ['title', 'description', 'keywords', 'category', 'fictionalPeople', 'suitableForVector']
  };

  // Rotate across available API keys and models (Prioritizing Gemini 3.8 Flash)
  const models = [
    settings.preferredModel || 'gemini-3.8-flash',
    'gemini-3.8-flash',
    'gemini-3.8-pro',
    'gemini-2.5-flash'
  ].filter((m, idx, arr) => arr.indexOf(m) === idx);

  let lastError = null;
  const startKeyIdx = Math.floor(Math.random() * keys.length);

  for (let kOffset = 0; kOffset < keys.length; kOffset++) {
    const apiKey = keys[(startKeyIdx + kOffset) % keys.length];
    let discovered = false;

    for (let mIdx = 0; mIdx < models.length; mIdx++) {
      const model = models[mIdx];
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: systemPrompt },
                  {
                    inlineData: {
                      mimeType,
                      data: base64
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              temperature: 0.25,
              responseMimeType: 'application/json',
              responseSchema
            }
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const msg = errData?.error?.message || `HTTP ${response.status}`;
          // 1. Auto-detect recommended replacement model from Google API error message
          const suggestedMatch = msg.match(/models\/([a-zA-Z0-9._-]+)/);
          if (suggestedMatch && suggestedMatch[1] && !models.includes(suggestedMatch[1])) {
            models.splice(mIdx + 1, 0, suggestedMatch[1]);
          } else if (!discovered && (response.status === 404 || response.status === 400)) {
            // 2. Query /v1beta/models to discover active models for this API key
            discovered = true;
            const liveModels = await discoverAvailableVisionModels(apiKey);
            for (const lm of liveModels) {
              if (!models.includes(lm)) models.push(lm);
            }
          }
          throw new Error(`[${model}] ${msg}`);
        }

        const result = await response.json();
        const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          throw new Error('Respons JSON dari Gemini kosong.');
        }

        const parsed = JSON.parse(rawText);
        const cleanTitle = sanitizeAdobeTitle(parsed.title);
        const cleanKeywords = sanitizeAdobeKeywords(parsed.keywords, cleanTitle, keywordCount, isVector);
        const matchedCat = ADOBE_CATEGORIES.find(
          c => c.name.toLowerCase() === (parsed.category || '').toLowerCase()
        )?.name || 'Graphic Resources';

        return {
          title: cleanTitle,
          description: sanitizeAdobeTitle(parsed.description || cleanTitle),
          keywords: cleanKeywords,
          category: matchedCat,
          isAiGenerated: true,
          fictionalPeople: Boolean(parsed.fictionalPeople),
          suitableForVector: Boolean(parsed.suitableForVector),
          visualSummary: parsed.visualSummary || '',
          modelUsed: model
        };
      } catch (err) {
        lastError = err;
        console.warn(`Gemini attempt notice (${model}):`, err.message);
      }
    }
  }

  throw new Error(`Gagal menganalisis gambar dengan Gemini Vision API: ${lastError?.message || 'Periksa kembali API Key atau koneksi internet Anda.'}`);
}

/**
 * Audits an image item and its metadata against Adobe Stock Contributor Rejection Criteria
 */
export function auditAdobeCompliance(item) {
  const issues = [];
  let score = 100;

  const mp = item.upscaledMegapixels || item.originalMegapixels || 0;
  if (mp < 4.0) {
    issues.push({
      severity: 'error',
      code: 'RES_BELOW_4MP',
      message: `Resolusi (${mp.toFixed(2)} MP) di bawah syarat minimal Adobe Stock (4.0 MP). Wajib di-upscale!`
    });
    score -= 40;
  } else if (mp < 5.5) {
    issues.push({
      severity: 'warning',
      code: 'RES_MARGINAL',
      message: `Resolusi ${mp.toFixed(2)} MP lolos batas minimum 4MP, namun disarankan 8 MP+ untuk gambar Generative AI.`
    });
    score -= 8;
  }

  const sizeBytes = item.upscaledSize || item.originalSize || 0;
  if (sizeBytes > 45 * 1024 * 1024) {
    issues.push({
      severity: 'error',
      code: 'FILE_TOO_LARGE',
      message: `Ukuran file (${(sizeBytes / 1048576).toFixed(1)} MB) mendekati/melebihi batas upload 45 MB.`
    });
    score -= 25;
  }

  const meta = item.metadata;
  if (!meta || !meta.title) {
    issues.push({
      severity: 'error',
      code: 'MISSING_METADATA',
      message: 'Metadata belum di-generate. Klik tombol "Vision AI Meta" untuk menganalisis gambar.'
    });
    score -= 35;
    return { score: Math.max(0, score), issues };
  }

  const title = meta.title.trim();
  if (title.length < 35) {
    issues.push({
      severity: 'warning',
      code: 'TITLE_SHORT',
      message: `Judul terlalu pendek (${title.length} karakter). Standar SEO Adobe Stock: 50–70 karakter.`
    });
    score -= 10;
  } else if (title.length > 85) {
    issues.push({
      severity: 'warning',
      code: 'TITLE_LONG',
      message: `Judul terlalu panjang (${title.length} karakter). Optimal: 50–70 karakter.`
    });
    score -= 5;
  }

  // Check banned brands/buzzwords in title
  const foundBrands = BANNED_BRANDS.filter(b => new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title));
  if (foundBrands.length > 0) {
    issues.push({
      severity: 'error',
      code: 'TRADEMARK_TITLE',
      message: `Judul mengandung kata merek/trademark terlarang: "${foundBrands.join(', ')}". Berisiko langsung di-reject!`
    });
    score -= 35;
  }

  const foundBuzz = BANNED_BUZZWORDS.filter(b => new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title));
  if (foundBuzz.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'BUZZWORD_TITLE',
      message: `Judul mengandung istilah teknis/spam ("${foundBuzz.join(', ')}"). Sebaiknya dihapus.`
    });
    score -= 15;
  }

  const kws = meta.keywords || [];
  if (kws.length < 25) {
    issues.push({
      severity: 'warning',
      code: 'FEW_KEYWORDS',
      message: `Jumlah keyword baru ${kws.length} (Disarankan 35–45 keyword untuk jangkauan maksimal di Adobe Stock).`
    });
    score -= 12;
  } else if (kws.length > 49) {
    issues.push({
      severity: 'error',
      code: 'EXCESS_KEYWORDS',
      message: `Jumlah keyword (${kws.length}) melebihi batas maksimal Adobe Stock (49 keywords).`
    });
    score -= 20;
  }

  if (meta.fictionalPeople) {
    issues.push({
      severity: 'info',
      code: 'FICTIONAL_PEOPLE_REMINDER',
      message: 'Terdeteksi figur manusia/karakter: Pastikan centang "Created using generative AI" & "People and property are fictional" saat submit di Adobe Stock.'
    });
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    issues
  };
}

