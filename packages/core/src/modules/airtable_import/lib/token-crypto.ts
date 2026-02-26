import crypto from "node:crypto";
import {
  encryptWithAesGcm,
  decryptWithAesGcm,
} from "@open-mercato/shared/lib/encryption/aes";

/**
 * Derive a stable 32-byte AES-256 key from NEXTAUTH_SECRET.
 * SHA-256 of the secret produces exactly 32 bytes; encoding as base64 gives the
 * 44-character string expected by encryptWithAesGcm / decryptWithAesGcm.
 */
function getDek(): string {
  const secret =
    process.env.NEXTAUTH_SECRET ?? "dev-secret-placeholder-min-32-chars!!";
  return crypto.createHash("sha256").update(secret).digest("base64");
}

/**
 * Encrypt an Airtable Personal Access Token before storing in the database.
 * Returns the encrypted payload string (format: iv:ciphertext:tag:v1).
 */
export function encryptToken(plaintext: string): string {
  const { value } = encryptWithAesGcm(plaintext, getDek());
  if (value == null) {
    throw new Error("Token encryption failed — refusing to store plaintext");
  }
  return value;
}

/**
 * Decrypt an Airtable token read from the database.
 * Falls back to returning the raw value as-is if it is not a recognised
 * encrypted payload (backwards-compatibility for any pre-encryption rows).
 */
export function decryptToken(stored: string): string {
  const decrypted = decryptWithAesGcm(stored, getDek());
  return decrypted ?? stored;
}
