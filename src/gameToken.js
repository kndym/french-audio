// Shared secret for daily token generation.
// This exact string must also appear in the game site repo.
// DO NOT share publicly.
const SHARED_SECRET = '7x2Kp9mN4qR8vL3jW6sF1tY5hB0cD9aEzU4wQ8nX1rJ6mP3oT7vC2yG5kH0bI';

export const GAME_SITE_URL = 'https://ankiflappy.vercel.app';

/**
 * Generate today's unlock token using HMAC-SHA256(secret, YYYY-MM-DD).
 * Returns a 64-char hex string. Both sites call this independently —
 * they match only if the secret matches and it's the same UTC day.
 */
export async function generateDailyToken() {
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SHARED_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(dateStr));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
