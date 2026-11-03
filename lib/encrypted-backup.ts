import fs from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

// Versioned, fixed parameters: AES-256-GCM; magic + nonce is authenticated AAD.
const MAGIC = Buffer.from('GIBBAK01', 'ascii');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + NONCE_BYTES;
const MAX_PLAINTEXT = 16 * 1024 ** 3;

export function backupKeyFromEnvironment(value: string | undefined): Buffer {
  // Exactly 32 random bytes, not a user-chosen password. Never print this value.
  if (!value || !/^[0-9a-fA-F]{64}$/.test(value)) throw new Error('GIB_BACKUP_KEY_HEX must contain exactly 64 hexadecimal characters (32 random bytes)');
  return Buffer.from(value, 'hex');
}

export async function encryptFile(source: string, target: string, key: Buffer): Promise<void> {
  const size = fs.statSync(source).size;
  if (size <= 0 || size > MAX_PLAINTEXT) throw new Error('Invalid snapshot size');
  const nonce = randomBytes(NONCE_BYTES);
  const header = Buffer.concat([MAGIC, nonce]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  fs.writeFileSync(target, header, { flag: 'wx', mode: 0o600 });
  await pipeline(fs.createReadStream(source), cipher, fs.createWriteStream(target, { flags: 'a', mode: 0o600 }));
  fs.appendFileSync(target, cipher.getAuthTag());
}

export async function decryptFile(source: string, target: string, key: Buffer): Promise<void> {
  const fd = fs.openSync(source, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= HEADER_BYTES + TAG_BYTES || size - HEADER_BYTES - TAG_BYTES > MAX_PLAINTEXT) throw new Error('Invalid encrypted backup size');
    const header = Buffer.alloc(HEADER_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length || fs.readSync(fd, tag, 0, tag.length, size - tag.length) !== tag.length || !header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid encrypted backup header');
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    // Keep the descriptor open and use it for the payload too, preventing path replacement races.
    const input = fs.createReadStream(source, { fd, autoClose: false, start: HEADER_BYTES, end: size - TAG_BYTES - 1 });
    await pipeline(input, decipher, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  } finally { fs.closeSync(fd); }
}
