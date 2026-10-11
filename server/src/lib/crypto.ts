import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let key: Buffer | undefined;

/** The 32-byte key derived from APP_SECRET, or from a secret generated once into DATA_DIR. */
function getKey(): Buffer {
  if (key) return key;
  let secret = config.APP_SECRET;
  if (!secret) {
    const file = path.join(config.dataDir, 'app-secret');
    if (fs.existsSync(file)) {
      secret = fs.readFileSync(file, 'utf8').trim();
    } else {
      fs.mkdirSync(config.dataDir, { recursive: true });
      secret = crypto.randomBytes(32).toString('base64url');
      fs.writeFileSync(file, secret, { mode: 0o600 });
      console.log(`[crypto] Generated an encryption secret in ${file}. Back it up; saved keys can't be read without it.`);
    }
  }
  key = crypto.createHash('sha256').update(secret).digest();
  return key;
}

/** For tests: use a fixed secret. */
export function setSecretForTests(secret: string): void {
  key = crypto.createHash('sha256').update(secret).digest();
}

/** AES-256-GCM. Output: "v1:" + base64url(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function decrypt(token: string): string {
  if (!token.startsWith('v1:')) throw new Error('Unknown secret format');
  const buf = Buffer.from(token.slice(3), 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

export const encryptOrNull = (v: string | null | undefined) => (v ? encrypt(v) : null);
export const decryptOrUndefined = (v: string | null | undefined) => (v ? decrypt(v) : undefined);

/** "••••4f2A" — enough to recognise a key without revealing it. */
export function hint(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return '••••' + secret.slice(-4);
}
