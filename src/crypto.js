/**
 * Browser-side decryption of the API key using Web Crypto API.
 *
 * Matches the encryption done by scripts/encrypt-key.js:
 *   PBKDF2 (SHA-256, 100k iterations) -> AES-256-GCM
 */

const ITERATIONS = 100_000;
const API_KEY_STORAGE = 'french-gemini-api-key';

/**
 * Decrypt the API key from key.enc.json using the given password.
 *
 * @param {string} password
 * @returns {Promise<string>} the decrypted API key
 * @throws if password is wrong or file is missing
 */
export async function decryptApiKey(password) {
  // Fetch the encrypted blob
  const res = await fetch('/key.enc.json');
  if (!res.ok) throw new Error('No encrypted key found (key.enc.json missing)');
  const { salt, iv, data } = await res.json();

  // Decode base64
  const saltBytes = Uint8Array.from(atob(salt), (c) => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const dataBytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

  // Derive the same AES key from password via PBKDF2
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  // Decrypt (Web Crypto expects authTag appended to ciphertext, which is how we stored it)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    aesKey,
    dataBytes,
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Try to unlock the API key with a password.
 * On success, stores the key in localStorage and returns it.
 *
 * @param {string} password
 * @returns {Promise<string>} the API key
 */
export async function unlockApiKey(password) {
  const key = await decryptApiKey(password);
  localStorage.setItem(API_KEY_STORAGE, key);
  return key;
}

/**
 * Check if an encrypted key file exists on the server.
 * @returns {Promise<boolean>}
 */
export async function hasEncryptedKey() {
  try {
    const res = await fetch('/key.enc.json', { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}
