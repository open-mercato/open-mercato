/**
 * Encryption at rest for web-search adapter credentials.
 *
 * Adapter API keys are masked on the wire (`maskSecrets`) but were written to
 * `module_configs.value` in plaintext, so a database dump — or anyone with read
 * access to that one table — held every tenant's SERP, Exa and Firecrawl keys.
 * Masking protects the browser; it does nothing for the row.
 *
 * The keys are encrypted with the tenant's own DEK, the same one
 * `TenantDataEncryptionService` issues for entity fields. The map-driven
 * `encryptEntityPayload` path does not fit: it keys off an `entityId` and a flat
 * field list, while these values are nested under
 * `adapterOptions.<adapterId>.<field>` in a generic key/value document. So this
 * uses the same AES-GCM primitive directly, and encrypts EXACTLY the fields the
 * adapter itself declared `secret: true` — never a guess at what looks
 * sensitive.
 *
 * **Degradation is deliberate and visible.** When tenant data encryption is off
 * (no `OM_TENANT_DATA_ENCRYPTION`, or KMS unhealthy) there is no DEK, so the
 * values are stored as they were before — and `encryptAdapterSecrets` reports
 * `encrypted: false` so the caller can log it and the settings page can say so.
 * Failing the save instead would break every deployment that does not run KMS,
 * which is a worse outcome than a warned-about plaintext key. What must never
 * happen is silence.
 *
 * SERVER ONLY.
 */
import type { AwilixContainer } from 'awilix'
import {
  describeOptionsSchema,
  resolveAdapterModules,
  type AdapterRegistryEntry,
} from '@open-mercato/web-research'
import { decryptWithAesGcm, encryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'

/** The subset of `TenantDataEncryptionService` this needs. */
type EncryptionServiceLike = {
  isEnabled(): boolean
  getDek(tenantId: string | null | undefined): Promise<{ key: string } | null>
}

export type AdapterSecretField = { name: string; secret?: boolean }

/** `describeOptionsSchema(module)` shape, narrowed to what matters here. */
export type AdapterSecretFields = Record<string, readonly AdapterSecretField[]>

export type EncryptAdapterSecretsResult = {
  adapterOptions: Record<string, unknown>
  /** False when no DEK was available — the caller MUST surface this. */
  encrypted: boolean
}

function resolveEncryptionService(container: AwilixContainer): EncryptionServiceLike | null {
  try {
    const service = container.resolve('tenantDataEncryptionService') as EncryptionServiceLike
    return typeof service?.isEnabled === 'function' ? service : null
  } catch {
    return null
  }
}

async function resolveDek(
  container: AwilixContainer,
  tenantId: string | null,
): Promise<string | null> {
  const service = resolveEncryptionService(container)
  if (!service || !service.isEnabled()) return null
  try {
    const dek = await service.getDek(tenantId)
    return dek?.key ?? null
  } catch {
    return null
  }
}

function secretNames(fields: readonly AdapterSecretField[] | undefined): string[] {
  return (fields ?? []).filter((field) => field.secret === true).map((field) => field.name)
}

/**
 * Encrypt every declared-secret option value in place.
 *
 * A value that already decrypts under this DEK is left alone rather than
 * double-wrapped — the settings PUT restores unchanged secrets from the stored
 * row, so on every save most values arrive already encrypted.
 */
export async function encryptAdapterSecrets(
  container: AwilixContainer,
  tenantId: string | null,
  adapterOptions: Record<string, unknown>,
  fieldsByAdapter: AdapterSecretFields,
): Promise<EncryptAdapterSecretsResult> {
  const dek = await resolveDek(container, tenantId)
  if (!dek) return { adapterOptions, encrypted: false }

  const next: Record<string, unknown> = { ...adapterOptions }
  for (const [adapterId, rawOptions] of Object.entries(adapterOptions)) {
    if (typeof rawOptions !== 'object' || rawOptions === null) continue
    const names = secretNames(fieldsByAdapter[adapterId])
    if (names.length === 0) continue

    const options = { ...(rawOptions as Record<string, unknown>) }
    for (const name of names) {
      const value = options[name]
      if (typeof value !== 'string' || value.length === 0) continue
      if (decryptWithAesGcm(value, dek) !== null) continue
      options[name] = encryptWithAesGcm(value, dek).value
    }
    next[adapterId] = options
  }
  return { adapterOptions: next, encrypted: true }
}

/**
 * Decrypt every declared-secret option value.
 *
 * A value that does not decrypt is passed through unchanged: it is either a
 * plaintext key written before this shipped, or one written while encryption was
 * off. Dropping it would break a working adapter to prove a point.
 */
export async function decryptAdapterSecrets(
  container: AwilixContainer,
  tenantId: string | null,
  adapterOptions: Record<string, unknown>,
  fieldsByAdapter: AdapterSecretFields,
): Promise<Record<string, unknown>> {
  const dek = await resolveDek(container, tenantId)
  if (!dek) return adapterOptions

  const next: Record<string, unknown> = { ...adapterOptions }
  for (const [adapterId, rawOptions] of Object.entries(adapterOptions)) {
    if (typeof rawOptions !== 'object' || rawOptions === null) continue
    const names = secretNames(fieldsByAdapter[adapterId])
    if (names.length === 0) continue

    const options = { ...(rawOptions as Record<string, unknown>) }
    for (const name of names) {
      const value = options[name]
      if (typeof value !== 'string' || value.length === 0) continue
      const plain = decryptWithAesGcm(value, dek)
      if (plain !== null) options[name] = plain
    }
    next[adapterId] = options
  }
  return next
}

/**
 * Which option fields each installed adapter declares secret.
 *
 * Read from the adapters themselves rather than from a list here, so a
 * third-party adapter's credential is protected the moment it is installed —
 * a hand-maintained list would silently miss it.
 */
export function adapterSecretFields(container: AwilixContainer): AdapterSecretFields {
  let entries: readonly AdapterRegistryEntry[]
  try {
    entries = (container.resolve('webResearchAdapterEntries') as AdapterRegistryEntry[]) ?? []
  } catch {
    return {}
  }
  const fields: Record<string, readonly AdapterSecretField[]> = {}
  for (const loaded of resolveAdapterModules(entries).loaded) {
    fields[loaded.module.id] = describeOptionsSchema(loaded.module) as readonly AdapterSecretField[]
  }
  return fields
}

/**
 * Whether a stored credential would be encrypted right now.
 *
 * Asked BEFORE a save so the settings page can warn while the operator is still
 * deciding whether to paste a key, rather than after the key is already on disk
 * in the clear.
 */
export async function canEncryptSecrets(
  container: AwilixContainer,
  tenantId: string | null,
): Promise<boolean> {
  return (await resolveDek(container, tenantId)) !== null
}
