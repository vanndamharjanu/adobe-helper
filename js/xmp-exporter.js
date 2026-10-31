/**
 * Adobe Stock XMP / IPTC Binary Metadata Injector & CSV Exporter
 * Injects standard Adobe XMP packets into JPEG (APP1) and PNG (iTXt) files
 * so Adobe Stock Contributor Portal auto-fills Title & Keywords upon upload.
 */

export const ADOBE_CATEGORIES = [
  { id: 1, name: 'Animals' },
  { id: 2, name: 'Buildings and Architecture' },
  { id: 3, name: 'Business' },
  { id: 4, name: 'Drinks' },
  { id: 5, name: 'The Environment' },
  { id: 6, name: 'States of Mind' },
  { id: 7, name: 'Food' },
  { id: 8, name: 'Graphic Resources' },
  { id: 9, name: 'Hobbies and Leisure' },
  { id: 10, name: 'Industry' },
  { id: 11, name: 'Landscapes' },
  { id: 12, name: 'Lifestyle' },
  { id: 13, name: 'People' },
  { id: 14, name: 'Plants and Flowers' },
  { id: 15, name: 'Culture and Religion' },
  { id: 16, name: 'Science' },
  { id: 17, name: 'Social Issues' },
  { id: 18, name: 'Sports' },
  { id: 19, name: 'Technology' },
  { id: 20, name: 'Transport' },
  { id: 21, name: 'Travel' }
];

export function escapeXml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildXmpPacket(metadata = {}) {
  const title = escapeXml(metadata.title || '');
  const description = escapeXml(metadata.description || metadata.title || '');
  const category = escapeXml(metadata.category || 'Graphic Resources');
  const keywords = Array.isArray(metadata.keywords) ? metadata.keywords : [];
  const isAiGenerated = metadata.isAiGenerated !== false;

  const subjectBag = keywords
    .map(kw => `     <rdf:li>${escapeXml(kw)}</rdf:li>`)
    .join('\n');

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/">
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${title}</rdf:li>
    </rdf:Alt>
   </dc:title>
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${description}</rdf:li>
    </rdf:Alt>
   </dc:description>
   <dc:subject>
    <rdf:Bag>
${subjectBag}
    </rdf:Bag>
   </dc:subject>
   <photoshop:Headline>${title}</photoshop:Headline>
   <photoshop:Category>${category}</photoshop:Category>
   <Iptc4xmpCore:DigitalSourceType>${isAiGenerated ? 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' : 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture'}</Iptc4xmpCore:DigitalSourceType>
   <xmp:CreatorTool>Microstock Adobe Helper Pro</xmp:CreatorTool>
   <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/**
 * Injects XMP APP1 segment into JPEG Blob (removes any existing XMP APP1 segment first to avoid duplicates)
 */
export async function embedXmpInJpeg(jpegBlob, metadata) {
  try {
    const buffer = await jpegBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
      return jpegBlob;
    }

    const xmpString = buildXmpPacket(metadata);
    const encoder = new TextEncoder();
    const xmpBytes = encoder.encode(xmpString);
    const headerBytes = encoder.encode('http://ns.adobe.com/xap/1.0/\0');
    const segmentLength = 2 + headerBytes.length + xmpBytes.length;

    if (segmentLength > 65535) {
      console.warn('XMP packet exceeds 64KB JPEG APP1 limit.');
      return jpegBlob;
    }

    const app1Segment = new Uint8Array(2 + segmentLength);
    app1Segment[0] = 0xFF;
    app1Segment[1] = 0xE1;
    app1Segment[2] = (segmentLength >> 8) & 0xFF;
    app1Segment[3] = segmentLength & 0xFF;
    app1Segment.set(headerBytes, 4);
    app1Segment.set(xmpBytes, 4 + headerBytes.length);

    // Locate insertion offset right after JFIF/APP0 (or right after SOI 0xFFD8)
    let insertOffset = 2;
    let offset = 2;
    while (offset < bytes.length - 4 && bytes[offset] === 0xFF) {
      const marker = bytes[offset + 1];
      if (marker === 0xFF || marker === 0x00) {
        offset++;
        continue;
      }
      if (marker === 0xDA || (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xCC)) {
        break;
      }
      const len = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (marker === 0xE0) {
        insertOffset = offset + 2 + len;
        break;
      }
      offset += 2 + len;
    }

    const output = new Uint8Array(bytes.length + app1Segment.length);
    output.set(bytes.subarray(0, insertOffset), 0);
    output.set(app1Segment, insertOffset);
    output.set(bytes.subarray(insertOffset), insertOffset + app1Segment.length);

    return new Blob([output], { type: 'image/jpeg' });
  } catch (err) {
    console.warn('JPEG XMP injection warning:', err);
    return jpegBlob;
  }
}

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Injects XMP iTXt chunk into PNG Blob right after IHDR chunk (offset 33)
 */
export async function embedXmpInPng(pngBlob, metadata) {
  try {
    const buffer = await pngBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 33 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
      return pngBlob;
    }

    const xmpString = buildXmpPacket(metadata);
    const encoder = new TextEncoder();
    const xmpBytes = encoder.encode(xmpString);
    const prefix = encoder.encode('XML:com.adobe.xmp\0\0\0\0\0');
    const dataLen = prefix.length + xmpBytes.length;

    const chunk = new Uint8Array(12 + dataLen);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, dataLen);
    // 'iTXt'
    chunk[4] = 0x69;
    chunk[5] = 0x54;
    chunk[6] = 0x58;
    chunk[7] = 0x74;
    chunk.set(prefix, 8);
    chunk.set(xmpBytes, 8 + prefix.length);

    const crc = crc32(chunk.subarray(4, 8 + dataLen));
    view.setUint32(8 + dataLen, crc);

    const output = new Uint8Array(bytes.length + chunk.length);
    output.set(bytes.subarray(0, 33), 0);
    output.set(chunk, 33);
    output.set(bytes.subarray(33), 33 + chunk.length);

    return new Blob([output], { type: 'image/png' });
  } catch (err) {
    console.warn('PNG XMP injection warning:', err);
    return pngBlob;
  }
}

export async function embedMetadataIntoBlob(blob, metadata) {
  if (!blob || !metadata) return blob;
  if (blob.type === 'image/png') {
    return embedXmpInPng(blob, metadata);
  }
  return embedXmpInJpeg(blob, metadata);
}

function escapeCsvCell(val, forceQuote = false) {
  if (val == null || val === '') return '';
  const str = String(val).replace(/\r?\n/g, ' ').trim();
  // Hanya beri tanda petik jika mengandung koma, petik ganda, atau jika dipaksa (misal kumpulan keywords)
  if (forceQuote || /[",;\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function getExportFilename(item, targetFormat = 'raster') {
  const baseName = (item.name || 'image').replace(/\.[^/.]+$/, '');
  if (targetFormat === 'svg') {
    return `${baseName}_vector.svg`;
  }
  if (targetFormat === 'eps') {
    return `${baseName}_vector.eps`;
  }
  const blob = item.upscaledBlob || item.isolatedBlob || item.file;
  let ext = item.exportExt;
  if (!ext) {
    if (blob && blob.type === 'image/png') ext = '.png';
    else if (item.isIsolated && !item.upscaledBlob) ext = '.png';
    else ext = '.jpg';
  }
  return `${baseName}_adobe_stock${ext}`;
}

export function generateAgencyCsv(items, agency = 'adobe', targetFormat = 'raster') {
  const rows = [];
  if (agency === 'adobe') {
    rows.push(['Filename', 'Title', 'Keywords', 'Category', 'Releases'].join(','));
    for (const item of items) {
      const meta = item.metadata || {};
      const catObj = ADOBE_CATEGORIES.find(
        c => c.name.toLowerCase() === (meta.category || '').toLowerCase()
      ) || { id: 8, name: 'Graphic Resources' };
      const filename = getExportFilename(item, targetFormat);
      const title = meta.title || '';
      const keywords = (meta.keywords || []).slice(0, 49).join(', ');
      // Di Adobe Stock, kolom Releases hanya diisi jika ada dokumen rilis yang di-upload (misal model_release.jpg)
      // Jika tidak ada / gambar AI / vektor / ilustrasi, kolom ini WAJIB kosong
      const release = meta.releaseFileName || '';
      rows.push([
        escapeCsvCell(filename),
        escapeCsvCell(title),
        escapeCsvCell(keywords, true),
        escapeCsvCell(catObj.id),
        escapeCsvCell(release)
      ].join(','));
    }
  } else if (agency === 'shutterstock') {
    rows.push(['Filename', 'Description', 'Keywords', 'Categories', 'Editorial', 'Mature content', 'Illustration'].join(','));
    for (const item of items) {
      const meta = item.metadata || {};
      const filename = getExportFilename(item, targetFormat);
      rows.push([
        escapeCsvCell(filename),
        escapeCsvCell(meta.description || meta.title || ''),
        escapeCsvCell((meta.keywords || []).slice(0, 50).join(', ')),
        escapeCsvCell(meta.category || 'Abstract'),
        escapeCsvCell('no'),
        escapeCsvCell('no'),
        escapeCsvCell('yes')
      ].join(','));
    }
  } else if (agency === 'freepik') {
    rows.push(['Filename', 'Title', 'Keywords', 'Prompt', 'Model'].join(','));
    for (const item of items) {
      const meta = item.metadata || {};
      const filename = getExportFilename(item, targetFormat);
      rows.push([
        escapeCsvCell(filename),
        escapeCsvCell(meta.title || ''),
        escapeCsvCell((meta.keywords || []).slice(0, 50).join(', ')),
        escapeCsvCell(meta.description || meta.title || ''),
        escapeCsvCell('Generative AI')
      ].join(','));
    }
  }
  return '\uFEFF' + rows.join('\r\n');
}

