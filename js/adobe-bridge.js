/**
 * Chrome Extension Bridge (Side Panel <-> Adobe Stock Contributor Tab)
 * Safe no-op when running as a regular GitHub Pages / web app.
 */

export function isExtensionContext() {
  return typeof chrome !== 'undefined' && Boolean(chrome?.runtime?.id) && Boolean(chrome?.tabs);
}

export async function findAdobeContributorTab(openIfMissing = false) {
  if (!isExtensionContext()) return null;
  const tabs = await chrome.tabs.query({ url: 'https://contributor.stock.adobe.com/*' });
  if (tabs.length > 0) {
    const active = tabs.find(t => t.active) || tabs[0];
    return active;
  }
  if (openIfMissing) {
    return await chrome.tabs.create({ url: 'https://contributor.stock.adobe.com/en/uploads', active: true });
  }
  return null;
}

export async function sendMessageToAdobeTab(tabId, payload) {
  if (!isExtensionContext() || tabId == null) {
    throw new Error('Mode Chrome Extension tidak aktif.');
  }
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (err) {
    // Content script might not be injected yet if tab was already open before install
    if (chrome.scripting?.executeScript) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['extension/content-adobe.js']
      });
      return await chrome.tabs.sendMessage(tabId, payload);
    }
    throw err;
  }
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  const parts = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(parts.join(''));
}
