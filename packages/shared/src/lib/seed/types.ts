import { z } from 'zod'

export const SEED_DOCUMENT_FORMAT = 'om-seed'
export const SEED_DOCUMENT_VERSION = 1

export const ENCRYPTED_SEED_FORMAT = 'om-encrypted-seed'
export const ENCRYPTED_SEED_VERSION = 1
export const ENCRYPTED_SEED_ALGORITHM = 'aes-256-gcm'

/**
 * A single record to seed. `entity` is the platform entity id (`module:entity`,
 * e.g. `customers:customer_entity`). `data` keys are the entity's own property
 * names (camelCase, as declared on the MikroORM entity). `match`, when present,
 * lists property names used for an idempotent existence check before insert —
 * these MUST be non-encrypted natural keys (id, slug, code, *_hash); encrypted
 * fields cannot be matched because their ciphertext is non-deterministic.
 */
export const seedRecordSchema = z.object({
  entity: z.string().min(1),
  match: z.array(z.string().min(1)).optional(),
  data: z.record(z.string(), z.unknown()),
})
export type SeedRecord = z.infer<typeof seedRecordSchema>

/**
 * The plaintext seed document. Records are applied in array order so authors can
 * satisfy foreign-key dependencies (create the parent before the child). The
 * document MUST NOT hard-code `tenantId`/`organizationId` — the loader injects
 * the target scope at load time so the same document seeds any tenant.
 */
export const seedDocumentSchema = z.object({
  format: z.literal(SEED_DOCUMENT_FORMAT),
  version: z.literal(SEED_DOCUMENT_VERSION),
  records: z.array(seedRecordSchema),
})
export type SeedDocument = z.infer<typeof seedDocumentSchema>

/**
 * The committed-to-repo, opaque envelope. `payload` is the encrypted seed
 * document in the shared AES-GCM `iv:ct:tag:v1` wire format.
 */
export const encryptedSeedEnvelopeSchema = z.object({
  format: z.literal(ENCRYPTED_SEED_FORMAT),
  version: z.literal(ENCRYPTED_SEED_VERSION),
  algorithm: z.literal(ENCRYPTED_SEED_ALGORITHM),
  payload: z.string().min(1),
})
export type EncryptedSeedEnvelope = z.infer<typeof encryptedSeedEnvelopeSchema>
