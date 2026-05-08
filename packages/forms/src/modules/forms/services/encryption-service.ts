/**
 * Forms module envelope encryption service.
 *
 * Lifts a per-tenant data-encryption key (DEK) wrapped under a master KMS key,
 * caches the unwrapped DEK in-memory, and uses it to encrypt/decrypt
 * submission revision payloads with AES-256-GCM. Ciphertext is self-describing
 * — the header carries the format version and the key version, so older
 * revisions remain decryptable across rotations.
 *
 * The `data` column on `forms_form_submission_revision` is encrypted by THIS
 * service, NOT by the global `findWithDecryption` pipeline. Phase 1c spec
 * (Cross-Cutting Concerns: encryption) is the source of truth for the format.
 *
 * Ciphertext layout:
 *   version(2B big-endian) | key_version(2B big-endian) | iv(12B) | ciphertext | tag(16B)
 * Format version is `0x0001` for v1; if/when the format changes, bump and
 * dispatch on the leading two bytes.
 *
 * KMS integration:
 *   The master key is referenced by `FORMS_ENCRYPTION_KMS_KEY_ID` (env). In
 *   production, the wrap/unwrap of the per-tenant DEK SHOULD be delegated to
 *   the operator's KMS (AWS KMS, GCP KMS, HashiCorp Vault, etc.) via a
 *   provider plugin. This phase ships a DEV-ONLY deterministic AES-KW-style
 *   wrap derived from the kms-key-id string — adequate for local development,
 *   tests, and CI but NEVER for production. The production KMS adapter slot
 *   is `kmsAdapter`; default falls back to the dev fallback.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CompiledFormVersion } from './form-version-compiler'
import { FormsEncryptionKey } from '../data/entities'

const FORMAT_VERSION_V1 = 0x0001
const HEADER_LENGTH = 4 // 2 bytes format version + 2 bytes key version
const IV_LENGTH = 12
const TAG_LENGTH = 16
const DEK_LENGTH = 32
const ALGORITHM = 'aes-256-gcm' as const
const DEFAULT_DEK_TTL_MS = 60 * 60 * 1000 // 1 hour
const DEFAULT_DEK_CACHE_MAX = 256

export class FormsEncryptionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'FormsEncryptionError'
    this.code = code
  }
}

export interface KmsAdapter {
  /** Wraps a fresh 32-byte DEK under the master key (returns ciphertext). */
  wrap(dek: Buffer): Promise<Buffer>
  /** Unwraps a stored wrapped DEK (returns plaintext). */
  unwrap(wrapped: Buffer): Promise<Buffer>
}

/**
 * DEV-ONLY KMS adapter — derives a deterministic AES-256-GCM "wrap" key from
 * `FORMS_ENCRYPTION_KMS_KEY_ID`. Provides envelope encryption for local
 * development, tests, and CI. Operators MUST replace this with a real KMS
 * adapter before production rollout.
 */
export class DevDeterministicKmsAdapter implements KmsAdapter {
  private readonly wrapKey: Buffer

  constructor(kmsKeyId: string) {
    if (!kmsKeyId || typeof kmsKeyId !== 'string') {
      throw new FormsEncryptionError(
        'KMS_KEY_ID_MISSING',
        'FORMS_ENCRYPTION_KMS_KEY_ID is required (dev fallback derives the wrap key from this id).',
      )
    }
    this.wrapKey = createHash('sha256').update(`forms-enc-v1::${kmsKeyId}`).digest()
  }

  async wrap(dek: Buffer): Promise<Buffer> {
    if (dek.length !== DEK_LENGTH) {
      throw new FormsEncryptionError('DEK_INVALID_LENGTH', 'DEK must be 32 bytes.')
    }
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, this.wrapKey, iv)
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, ciphertext, tag])
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    if (wrapped.length !== IV_LENGTH + DEK_LENGTH + TAG_LENGTH) {
      throw new FormsEncryptionError('WRAPPED_DEK_INVALID_LENGTH', 'Wrapped DEK has unexpected length.')
    }
    const iv = wrapped.subarray(0, IV_LENGTH)
    const ciphertext = wrapped.subarray(IV_LENGTH, IV_LENGTH + DEK_LENGTH)
    const tag = wrapped.subarray(IV_LENGTH + DEK_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, this.wrapKey, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  }
}

export type EncryptionServiceOptions = {
  emFactory: () => EntityManager
  kmsAdapter?: KmsAdapter
  cacheMax?: number
  cacheTtlMs?: number
  /** Override the clock for tests. */
  now?: () => number
}

type DekCacheEntry = {
  dek: Buffer
  expiresAt: number
}

export interface EncryptionService {
  encrypt(organizationId: string, plaintext: Buffer): Promise<Buffer>
  decrypt(organizationId: string, ciphertext: Buffer): Promise<Buffer>
  currentKeyVersion(organizationId: string): Promise<number>
  rotate(organizationId: string): Promise<number>
}

export class FormsEncryptionService implements EncryptionService {
  private readonly emFactory: () => EntityManager
  private readonly kms: KmsAdapter
  private readonly cacheMax: number
  private readonly cacheTtlMs: number
  private readonly now: () => number
  private readonly dekCache = new Map<string, DekCacheEntry>()
  private readonly currentVersionCache = new Map<string, number>()

  constructor(options: EncryptionServiceOptions) {
    this.emFactory = options.emFactory
    this.cacheMax = options.cacheMax ?? DEFAULT_DEK_CACHE_MAX
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_DEK_TTL_MS
    this.now = options.now ?? (() => Date.now())
    if (options.kmsAdapter) {
      this.kms = options.kmsAdapter
    } else {
      const kmsKeyId = process.env.FORMS_ENCRYPTION_KMS_KEY_ID ?? ''
      this.kms = new DevDeterministicKmsAdapter(kmsKeyId || 'forms-dev-fallback-key-id')
    }
  }

  async encrypt(organizationId: string, plaintext: Buffer): Promise<Buffer> {
    const keyVersion = await this.currentKeyVersion(organizationId)
    const dek = await this.getDek(organizationId, keyVersion)
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, dek, iv)
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    const header = Buffer.alloc(HEADER_LENGTH)
    header.writeUInt16BE(FORMAT_VERSION_V1, 0)
    header.writeUInt16BE(keyVersion, 2)
    return Buffer.concat([header, iv, body, tag])
  }

  async decrypt(organizationId: string, ciphertext: Buffer): Promise<Buffer> {
    if (ciphertext.length < HEADER_LENGTH + IV_LENGTH + TAG_LENGTH) {
      throw new FormsEncryptionError('CIPHERTEXT_TOO_SHORT', 'Ciphertext too short to be a valid envelope.')
    }
    const formatVersion = ciphertext.readUInt16BE(0)
    if (formatVersion !== FORMAT_VERSION_V1) {
      throw new FormsEncryptionError(
        'UNSUPPORTED_FORMAT_VERSION',
        `Unsupported envelope format version ${formatVersion}.`,
      )
    }
    const keyVersion = ciphertext.readUInt16BE(2)
    const iv = ciphertext.subarray(HEADER_LENGTH, HEADER_LENGTH + IV_LENGTH)
    const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH)
    const body = ciphertext.subarray(HEADER_LENGTH + IV_LENGTH, ciphertext.length - TAG_LENGTH)
    const dek = await this.getDek(organizationId, keyVersion)
    const decipher = createDecipheriv(ALGORITHM, dek, iv)
    decipher.setAuthTag(tag)
    try {
      return Buffer.concat([decipher.update(body), decipher.final()])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown decryption error'
      throw new FormsEncryptionError('DECRYPTION_FAILED', `Failed to decrypt envelope: ${message}`)
    }
  }

  async currentKeyVersion(organizationId: string): Promise<number> {
    const cached = this.currentVersionCache.get(organizationId)
    if (typeof cached === 'number') return cached
    const em = this.emFactory()
    const active = await em.findOne(
      FormsEncryptionKey,
      { organizationId, retiredAt: null },
      { orderBy: { keyVersion: 'desc' } },
    )
    if (active) {
      this.currentVersionCache.set(organizationId, active.keyVersion)
      return active.keyVersion
    }
    const created = await this.createInitialKey(em, organizationId)
    this.currentVersionCache.set(organizationId, created.keyVersion)
    return created.keyVersion
  }

  async rotate(organizationId: string): Promise<number> {
    const em = this.emFactory()
    const current = await em.findOne(
      FormsEncryptionKey,
      { organizationId, retiredAt: null },
      { orderBy: { keyVersion: 'desc' } },
    )
    const nextVersion = (current?.keyVersion ?? 0) + 1
    const dek = randomBytes(DEK_LENGTH)
    const wrapped = await this.kms.wrap(dek)
    const fresh = em.create(FormsEncryptionKey, {
      organizationId,
      keyVersion: nextVersion,
      wrappedDek: wrapped,
      createdAt: new Date(this.now()),
    })
    if (current) {
      current.retiredAt = new Date(this.now())
    }
    em.persist(fresh)
    if (current) em.persist(current)
    await em.flush()
    this.currentVersionCache.set(organizationId, nextVersion)
    this.cacheDek(this.dekCacheKey(organizationId, nextVersion), dek)
    return nextVersion
  }

  /**
   * Test/maintenance hook: drop all in-memory cached DEKs.
   */
  resetCache(): void {
    this.dekCache.clear()
    this.currentVersionCache.clear()
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async createInitialKey(
    em: EntityManager,
    organizationId: string,
  ): Promise<FormsEncryptionKey> {
    const dek = randomBytes(DEK_LENGTH)
    const wrapped = await this.kms.wrap(dek)
    const row = em.create(FormsEncryptionKey, {
      organizationId,
      keyVersion: 1,
      wrappedDek: wrapped,
      createdAt: new Date(this.now()),
    })
    em.persist(row)
    await em.flush()
    this.cacheDek(this.dekCacheKey(organizationId, 1), dek)
    return row
  }

  private async getDek(organizationId: string, keyVersion: number): Promise<Buffer> {
    const cacheKey = this.dekCacheKey(organizationId, keyVersion)
    const cached = this.dekCache.get(cacheKey)
    if (cached && cached.expiresAt > this.now()) {
      // Refresh LRU position on hit.
      this.dekCache.delete(cacheKey)
      this.dekCache.set(cacheKey, cached)
      return cached.dek
    }
    if (cached) this.dekCache.delete(cacheKey)
    const em = this.emFactory()
    const row = await em.findOne(FormsEncryptionKey, { organizationId, keyVersion })
    if (!row) {
      throw new FormsEncryptionError(
        'DEK_NOT_FOUND',
        `Encryption key not found for organization ${organizationId} version ${keyVersion}.`,
      )
    }
    const wrapped = ensureBuffer(row.wrappedDek)
    const dek = await this.kms.unwrap(wrapped)
    this.cacheDek(cacheKey, dek)
    return dek
  }

  private dekCacheKey(organizationId: string, keyVersion: number): string {
    return `${organizationId}:${keyVersion}`
  }

  private cacheDek(cacheKey: string, dek: Buffer): void {
    while (this.dekCache.size >= this.cacheMax) {
      const oldest = this.dekCache.keys().next().value
      if (!oldest) break
      this.dekCache.delete(oldest)
    }
    this.dekCache.set(cacheKey, { dek, expiresAt: this.now() + this.cacheTtlMs })
  }
}

function ensureBuffer(value: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'binary')
  throw new FormsEncryptionError('WRAPPED_DEK_INVALID_TYPE', 'Wrapped DEK has unsupported representation.')
}

/**
 * Redaction helper used by the logger middleware for R1 mitigation.
 *
 * Walks the payload at the root level and replaces any field marked
 * `x-om-sensitive: true` in the compiled form version with `"[REDACTED]"`.
 * Designed for shallow form payloads; nested sensitive structures should be
 * handled by the field type's own redactor in future phases.
 */
export function redactSensitive(
  compiled: CompiledFormVersion,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return payload
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    const descriptor = compiled.fieldIndex[key]
    if (descriptor?.sensitive) {
      out[key] = '[REDACTED]'
    } else {
      out[key] = value
    }
  }
  return out
}
