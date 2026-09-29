import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifratura a riposo AES-256-GCM delle chiavi API (§ 6.2).
 * Chiave master = ENCRYPTION_KEY (32 byte) → fittata a una chiave AEAD
 * deterministica (SHA-256); output: base64(iv || ciphertext || tag).
 * Le chiavi non vengono mai loggate né spedite al client dopo il salvataggio.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function toAeadKey(secret: Buffer): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string, masterSecretHex: string): string {
  const key = toAeadKey(Buffer.from(masterSecretHex, "hex"));
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

export function decryptSecret(ciphertext: string, masterSecretHex: string): string {
  const key = toAeadKey(Buffer.from(masterSecretHex, "hex"));
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(raw.length - 16);
  const encrypted = raw.subarray(IV_LENGTH, raw.length - tag.length);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}