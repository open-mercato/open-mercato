import crypto from 'node:crypto'
import { isEncryptionDebugEnabled } from './toggles'
import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'encryption' })

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
    logger.debug(event, payload)
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

const LOOKUP_HASH_V2_PREFIX = 'v2:'

function normalizeLookupValue(value: string): string {
  return value.toLowerCase().trim()
}

/**
 * Legacy, unkeyed lookup digest (`sha256(lower(trim(value)))`).
 *
 * @deprecated Unkeyed digests are vulnerable to offline rainbow-table attacks and
 * cross-installation correlation (issue #2718). New writes use {@link hashForLookup},
 * which emits a keyed `v2:` HMAC when a lookup pepper is configured. This helper is
 * retained only so existing `*_hash` columns written before the keyed format can still
 * be matched (see {@link lookupHashCandidates}) until a backfill migration recomputes them.
 */
export function legacyHashForLookup(value: string): string {
  return crypto.createHash('sha256').update(normalizeLookupValue(value)).digest('hex')
}

/**
 * Resolve the installation-wide lookup pepper used to key lookup hashes.
 *
 * Order of precedence (never `AUTH_SECRET`, per issue #2718):
 * 1. `LOOKUP_HASH_PEPPER` — dedicated secret for lookup hashing
 * 2. `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` — existing encryption fallback secret
 * 3. `TENANT_DATA_ENCRYPTION_KEY` — existing encryption secret
 *
 * Returns `null` when no secret is configured, in which case {@link hashForLookup}
 * falls back to the legacy unkeyed digest so deployments without any configured key
 * keep working unchanged.
 */
function resolveLookupPepper(): string | null {
  const candidates = [
    process.env.LOOKUP_HASH_PEPPER,
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY,
    process.env.TENANT_DATA_ENCRYPTION_KEY,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const normalized = candidate.trim().replace(/(?:^['"]|['"]$)/g, '')
    if (normalized) return normalized
  }
  return null
}

/**
 * Compute a deterministic lookup hash for a low-entropy PII value (email, phone, …).
 *
 * When a lookup pepper is configured the result is a keyed HMAC-SHA-256 prefixed with
 * `v2:` and bound to the optional `context` (entity/field) so digests are not portable
 * across columns, installations, or tenants without the secret. When no pepper is
 * configured it falls back to the legacy unkeyed digest for backward compatibility.
 *
 * The `context` MUST be supplied identically on both the write and the read side for a
 * given column; callers that do not pass one stay mutually consistent.
 */
export function hashForLookup(value: string, context?: string): string {
  const pepper = resolveLookupPepper()
  const normalized = normalizeLookupValue(value)
  if (!pepper) {
    return legacyHashForLookup(value)
  }
  const message = context ? `${context}:${normalized}` : normalized
  const digest = crypto.createHmac('sha256', pepper).update(message).digest('hex')
  return `${LOOKUP_HASH_V2_PREFIX}${digest}`
}

/**
 * Candidate lookup hashes for matching a value against `*_hash` columns that may hold
 * either the new keyed (`v2:`) digest or a legacy unkeyed digest. Use this in `$in` /
 * `IN (...)` filters during the migration window so reads keep matching rows written
 * before the keyed format. Once a backfill has recomputed all columns this can collapse
 * back to a single {@link hashForLookup} value.
 */
export function lookupHashCandidates(value: string, context?: string): string[] {
  const primary = hashForLookup(value, context)
  const legacy = legacyHashForLookup(value)
  return primary === legacy ? [primary] : [primary, legacy]
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
