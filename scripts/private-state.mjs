/** Portable encrypted paper state. No credentials, storage, or network access. */
function encode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value) {
  if (typeof value !== 'string' || !value.length || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('Invalid encrypted state encoding.');
  }
  try {
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (encode(bytes) !== value) throw new Error();
    return bytes;
  } catch { throw new Error('Invalid encrypted state encoding.'); }
}

async function keyFromBase64(value, usage) {
  let bytes;
  try { bytes = decode(value); }
  catch { throw new Error('Paper state key must be a base64-encoded 32-byte key.'); }
  if (bytes.length !== 32) throw new Error('Paper state key must be a base64-encoded 32-byte key.');
  return globalThis.crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, usage);
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1) {
    throw new Error('Invalid private paper state.');
  }
}

export async function encryptState(state, keyBase64) {
  validateState(state);
  const key = await keyFromBase64(keyBase64, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  let plaintext;
  try { plaintext = new TextEncoder().encode(JSON.stringify(state)); }
  catch { throw new Error('Invalid private paper state.'); }
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, plaintext);
  return { version: 1, algorithm: 'AES-256-GCM', iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
}

export async function decryptState(envelope, keyBase64) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') {
    throw new Error('Invalid encrypted paper state envelope.');
  }
  const iv = decode(envelope.iv), ciphertext = decode(envelope.ciphertext);
  if (iv.length !== 12 || ciphertext.length < 18) throw new Error('Invalid encrypted paper state envelope.');
  const key = await keyFromBase64(keyBase64, ['decrypt']);
  try {
    const bytes = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ciphertext);
    const state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    validateState(state);
    return state;
  } catch { throw new Error('Unable to unlock private paper state.'); }
}
