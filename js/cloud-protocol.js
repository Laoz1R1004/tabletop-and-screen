// Shared validation only. No credentials or server implementation in this module.
export const BUCKET = 'tts-cloud-images';
export const MAX_IMAGE = 8 * 1024 * 1024;
export const MAX_DOCUMENT = 4 * 1024 * 1024;
export const ALLOWED_ORIGIN = 'https://laoz1r1004.github.io';
export const validHash = value => /^[a-f0-9]{64}$/.test(value || '');
export const validKey = value => /^[A-Za-z0-9_-]{43}$/.test(value || '');
export async function digest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function authorized(provided, secret) {
  if (!validKey(secret) || !validKey(provided)) return false;
  // Fixed-length hashed comparison; no plaintext token logging or early prefix exit.
  const a = await digest(new TextEncoder().encode(provided));
  const b = await digest(new TextEncoder().encode(secret));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function validateDocument(document) {
  if (!document || typeof document !== 'object' || !document.state || !Array.isArray(document.images)) return false;
  const s = document.state;
  if (!Array.isArray(s.games) || !Array.isArray(s.sessions) || !s.screen ||
      !Array.isArray(s.screen.games) || !Array.isArray(s.screen.wishlist) ||
      !Array.isArray(s.screen.priorityPlayIds) || s.screen.priorityPlayIds.length > 3 || !s.taxonomies || !s.screen.taxonomies) return false;
  const ids = new Set();
  for (const image of document.images) {
    if (!image || typeof image.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(image.id) ||
        ids.has(image.id) || !validHash(image.hash) || !Number.isSafeInteger(image.bytes) ||
        image.bytes < 1 || image.bytes > MAX_IMAGE || !/^image\/[a-zA-Z0-9.+-]+$/.test(image.mime)) return false;
    ids.add(image.id);
  }
  for (const game of [...s.games, ...s.screen.games]) {
    if (!game || typeof game.id !== 'string' || !ids.has(game.coverId)) return false;
    for (const expansion of game.expansions || []) if (!ids.has(expansion.coverId)) return false;
  }
  return true;
}
export async function readLimited(request, limit) {
  if (Number(request.headers.get('content-length') || 0) > limit) throw Error('REQUEST_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let count = 0; const chunks = [];
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      count += value.length;
      if (count > limit) { await reader.cancel(); throw Error('REQUEST_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
