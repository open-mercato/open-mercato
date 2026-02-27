import crypto from 'node:crypto'
import { isEncryptionDebugEnabled } from './toggles'

export type EncryptionPayload = {
  value: string | null
  raw: string
  version: string
}

export enum TenantDataEncryptionErrorCode {
  AUTH_FAILED = 'AUTH_FAILED',
  MALFORMED_PAYLOAD = 'MALFORMED_PAYLOAD',
  KMS_UNAVAILABLE = 'KMS_UNAVAILABLE',
  WRONG_KEY = 'WRONG_KEY',
  DECRYPT_INTERNAL = 'DECRYPT_INTERNAL',
}

export class TenantDataEncryptionError extends Error {
  code: TenantDataEncryptionErrorCode
  constructor(code: TenantDataEncryptionErrorCode, message: string) {
    super(message)
    this.name = 'TenantDataEncryptionError'
    this.code = code
  }
}

export function generateDek(): string {
  return crypto.randomBytes(32).toString('base64')
}

function logDebug(event: string, payload: Record<string, unknown>) {
  if (!isEncryptionDebugEnabled()) return
  try {
    // eslint-disable-next-line no-console
    console.debug('[encryption]', event, payload)
  } catch {
    // ignore
  }
}

export function encryptWithAesGcm(value: string, dekBase64: string): EncryptionPayload {
  const dek = Buffer.from(dekBase64, 'base64')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = [
    iv.toString('base64'),
    ciphertext.toString('base64'),
    tag.toString('base64'),
    'v1',
  ].join(':')
  logDebug('encrypt', { length: ciphertext.length })
  return { value: payload, raw: payload, version: 'v1' }
}

function runAesGcmDecrypt(dek: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

export function decryptWithAesGcm(payload: string, dekBase64: string): string | null {
  if (!payload) return null
  const parts = payload.split(':')
  if (parts.length !== 4) return null
  const [ivB64, ciphertextB64, tagB64, version] = parts
  if (version !== 'v1') return null
  const dek = Buffer.from(dekBase64, 'base64')
  const iv = Buffer.from(ivB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  try {
    const result = runAesGcmDecrypt(dek, iv, ciphertext, tag)
    logDebug('decrypt', { iv: ivB64, tag: tagB64 })
    return result
  } catch (err) {
    logDebug('decrypt_error', { message: (err as Error)?.message || String(err) })
    return null
  }
}

export function hashForLookup(value: string): string {
  return crypto.createHash('sha256').update(value.toLowerCase().trim()).digest('hex')
}

/**
 * Strict variant of decryptWithAesGcm that throws typed TenantDataEncryptionError.
 * - Format mismatch (not iv:ct:tag:v1): throws AUTH_FAILED (treat as plaintext).
 * - Valid format but invalid buffer sizes (bad base64): throws MALFORMED_PAYLOAD.
 * - AES-GCM auth tag failure: throws AUTH_FAILED.
 * - Unexpected crypto error: throws DECRYPT_INTERNAL.
 */
export function decryptWithAesGcmStrict(payload: string, dekBase64: string): string {
  const parts = payload.split(':')
  if (parts.length !== 4 || parts[3] !== 'v1') {
    throw new TenantDataEncryptionError(
      TenantDataEncryptionErrorCode.AUTH_FAILED,
      'Value is not an encrypted payload (format mismatch)',
    )
  }
  const [ivB64, ciphertextB64, tagB64] = parts as [string, string, string, string]
  let dek: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer
  try {
    dek = Buffer.from(dekBase64, 'base64')
    iv = Buffer.from(ivB64, 'base64')
    ciphertext = Buffer.from(ciphertextB64, 'base64')
    tag = Buffer.from(tagB64, 'base64')
  } catch {
    throw new TenantDataEncryptionError(
      TenantDataEncryptionErrorCode.MALFORMED_PAYLOAD,
      'Failed to decode base64 components',
    )
  }
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new TenantDataEncryptionError(
      TenantDataEncryptionErrorCode.MALFORMED_PAYLOAD,
      'Invalid AES-GCM payload: unexpected IV, tag, or ciphertext size',
    )
  }
  try {
    return runAesGcmDecrypt(dek, iv, ciphertext, tag)
  } catch {
    throw new TenantDataEncryptionError(
      TenantDataEncryptionErrorCode.AUTH_FAILED,
      'AES-GCM authentication tag verification failed',
    )
  }
}
