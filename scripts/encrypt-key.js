/**
 * Encrypt the Gemini API key using the password from .env.
 *
 * Produces public/key.enc.json containing { salt, iv, data } (all base64).
 * At runtime, the browser decrypts with the same password using Web Crypto.
 *
 * Algorithm: PBKDF2 (SHA-256, 100k iterations) -> AES-256-GCM
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Read .env ──────────────────────────────────────────────────
function readEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('No .env file found. Skipping key encryption.');
    process.exit(0);
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

const env = readEnv();
const apiKey = env.GEMINI_API_KEY;
const password = env.password;

if (!apiKey || !password) {
  console.error('Missing GEMINI_API_KEY or password in .env. Skipping key encryption.');
  process.exit(0);
}

// ── Encrypt ────────────────────────────────────────────────────
const ITERATIONS = 100_000;
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);

// Derive 256-bit key from password using PBKDF2
const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256');

// Encrypt with AES-256-GCM
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
let encrypted = cipher.update(apiKey, 'utf8');
encrypted = Buffer.concat([encrypted, cipher.final()]);
const authTag = cipher.getAuthTag(); // 16 bytes

// Web Crypto expects authTag appended to ciphertext
const data = Buffer.concat([encrypted, authTag]);

// ── Write output ───────────────────────────────────────────────
const output = {
  salt: salt.toString('base64'),
  iv: iv.toString('base64'),
  data: data.toString('base64'),
};

const outPath = path.join(ROOT, 'public', 'key.enc.json');
fs.writeFileSync(outPath, JSON.stringify(output));
console.log(`Encrypted API key written to ${outPath}`);
