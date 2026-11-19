import crypto from 'node:crypto'
import { decryptWithAesGcm, encryptWithAesGcm } from '../encryption/aes'
import {
  ENCRYPTED_SEED_ALGORITHM,
  ENCRYPTED_SEED_FORMAT,
  ENCRYPTED_SEED_VERSION,
  encryptedSeedEnvelopeSchema,
  seedDocumentSchema,
  type EncryptedSeedEnvelope,
  type SeedDocument,
} from './types'

/**
 * Distribution-layer key for encrypting seed blobs committed to the repo. This is
 * deliberately separate from the platform's per-tenant field-encryption keys
 * (Vault / TENANT_DATA_ENCRYPTION_*): rotating or sharing the seed key never
 * touches data-at-rest encryption.
 */
export const SEED_KEY_ENV = 'OM_SEED_KEY'

const SEED_KEY_BYTES = 32

function normalizeKey(value: string): string {
  return value.trim().replace(/(?:^['"]|['"]$)/g, '')
}

/** Generate a fresh base64-encoded 32-byte seed key. */
export function generateSeedKey(): string {
  return crypto.randomBytes(SEED_KEY_BYTES).toString('base64')
}

/**
 * Resolve and validate the seed key from an explicit value or `OM_SEED_KEY`.
 * Throws a clear, actionable error when missing or malformed.
 */
export function resolveSeedKey(explicit?: string | null): string {
  const raw = normalizeKey(explicit ?? process.env[SEED_KEY_ENV] ?? '')
  if (!raw) {
    throw new Error(
      `[internal] Seed key missing: set ${SEED_KEY_ENV} (base64, 32 bytes) or pass --key. Generate one with "mercato seeds keygen".`,
    )
  }
  let decoded: Buffer
  try {
    decoded = Buffer.from(raw, 'base64')
  } catch {
    throw new Error(`[internal] ${SEED_KEY_ENV} must be base64-encoded.`)
  }
  if (decoded.length !== SEED_KEY_BYTES) {
    throw new Error(
      `[internal] ${SEED_KEY_ENV} must decode to ${SEED_KEY_BYTES} bytes (got ${decoded.length}). Generate one with "mercato seeds keygen".`,
    )
  }
  return raw
}

/** Encrypt a validated seed document into the opaque, committable envelope. */
export function encryptSeedDocument(document: SeedDocument, key: string): EncryptedSeedEnvelope {
  const doc = seedDocumentSchema.parse(document)
  const json = JSON.stringify(doc)
  const { value } = encryptWithAesGcm(json, key)
  if (!value) {
    throw new Error('[internal] Seed encryption produced no payload.')
  }
  return {
    format: ENCRYPTED_SEED_FORMAT,
    version: ENCRYPTED_SEED_VERSION,
    algorithm: ENCRYPTED_SEED_ALGORITHM,
    payload: value,
  }
}

/** Decrypt and validate an envelope back into a seed document. */
export function decryptSeedEnvelope(envelope: unknown, key: string): SeedDocument {
  const parsed = encryptedSeedEnvelopeSchema.parse(envelope)
  const json = decryptWithAesGcm(parsed.payload, key)
  if (json === null) {
    throw new Error('[internal] Seed decryption failed — wrong key or corrupted payload.')
  }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('[internal] Decrypted seed is not valid JSON.')
  }
  return seedDocumentSchema.parse(raw)
}
