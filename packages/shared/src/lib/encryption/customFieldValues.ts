import type { EntityManager } from '@mikro-orm/core'
import { createLogger } from '../logger'
import { encryptWithAesGcm, decryptWithAesGcm } from './aes'
import { TenantDataEncryptionService } from './tenantDataEncryptionService'

const logger = createLogger('shared').child({ component: 'encryption' })

/**
 * Custom field kinds that ALWAYS round-trip as a string. The encrypt path
 * stores raw strings unwrapped, so blindly running `JSON.parse` on the
 * decrypted payload coerces text values like `"123"` or `"true"` back into
 * numbers/booleans (issue #1734). For these kinds, callers MUST pass the
 * `kind` option so we keep the decrypted value as a string.
 *
 * Numeric (`integer`/`float`) and `boolean` kinds rely on JSON round-trip
 * because the encrypt path JSON-stringifies the typed value before storage.
 * Omitting the kind preserves legacy round-trip behavior for backward
 * compatibility.
 */
const STRING_TYPED_CUSTOM_FIELD_KINDS = new Set([
  'text',
  'multiline',
  'select',
  'currency',
  'dictionary',
  'phone',
  'email',
  'url',
  'string',
])

export type DecryptCustomFieldOptions = {
  /** Field kind, e.g. from `CustomFieldDef.kind`. When string-typed, the helper preserves the decrypted string verbatim. */
  kind?: string | null
}

function shouldPreserveAsString(kind: string | null | undefined): boolean {
  if (!kind) return false
  return STRING_TYPED_CUSTOM_FIELD_KINDS.has(kind)
}

const serviceCache = new WeakMap<EntityManager, TenantDataEncryptionService>()

export function resolveTenantEncryptionService(
  em: EntityManager,
  provided?: TenantDataEncryptionService | null,
): TenantDataEncryptionService | null {
  if (provided) return provided
  const cached = serviceCache.get(em)
  if (cached) return cached
  const service = new TenantDataEncryptionService(em as any)
  serviceCache.set(em, service)
  return service
}

async function resolveDekKey(
  service: TenantDataEncryptionService | null,
  tenantId: string | null | undefined,
  cache?: Map<string | null, string | null>,
  opts?: { createIfMissing?: boolean },
): Promise<string | null> {
  const scopedTenantId = tenantId ?? null
  if (!service || !service.isEnabled() || !scopedTenantId) return null
  if (cache?.has(scopedTenantId)) return cache.get(scopedTenantId) ?? null
  const dek = await service.getDek(scopedTenantId)
  let key = dek?.key ?? null
  if (!key && opts?.createIfMissing && typeof service.createDek === 'function') {
    const created = await service.createDek(scopedTenantId)
    key = created?.key ?? null
  }
  cache?.set(scopedTenantId, key)
  return key
}

/**
 * Whether the caller asked for a write that is supposed to end up encrypted.
 *
 * `resolveDekKey` returns `null` for four different situations, three of which
 * are intentional no-ops: there is no encryption service, the feature is turned
 * off (`TENANT_DATA_ENCRYPTION`), or the record has no tenant scope. Only when
 * all three hold and the key STILL comes back empty did key resolution actually
 * fail, and only then is a plaintext write a degradation worth reporting.
 */
function isEncryptionExpected(
  service: TenantDataEncryptionService | null,
  tenantId: string | null | undefined,
): boolean {
  if (!service || !(tenantId ?? null)) return false
  return service.isEnabled()
}

// One warning per tenant/entity/field per process. A KMS outage makes this
// branch run for every field of every write, and an operator only needs to
// learn about each degraded field once.
const PLAINTEXT_FALLBACK_WARN_CAP = 5000
const plaintextFallbackWarned = new Set<string>()

/** Test seam: the warn-once cache is process-global by design. */
export function resetEncryptedFieldPlaintextFallbackWarnCache(): void {
  plaintextFallbackWarned.clear()
}

function warnOnPlaintextFallback(
  tenantId: string | null | undefined,
  options?: EncryptCustomFieldOptions,
): void {
  try {
    const scopedTenantId = tenantId ?? null
    const entity = options?.entityId ?? null
    const field = options?.fieldKey ?? null
    const warnKey = `${scopedTenantId}|${entity ?? 'unknown'}|${field ?? 'unknown'}`
    if (plaintextFallbackWarned.has(warnKey)) return
    if (plaintextFallbackWarned.size >= PLAINTEXT_FALLBACK_WARN_CAP) plaintextFallbackWarned.clear()
    plaintextFallbackWarned.add(warnKey)
    logger.warn('Custom field configured as encrypted was stored as plaintext', {
      tenantId: scopedTenantId,
      entity,
      field,
      hint: 'The tenant data encryption key could not be read or created (KMS/Vault unavailable, or DEK creation failed), so the value was written unencrypted. Restore key access and re-save the affected records.',
    })
  } catch {
    // A diagnostic must never break the write it is diagnosing.
  }
}

export type EncryptCustomFieldOptions = {
  /** Entity the value belongs to, e.g. `customers:person`. Used only to identify the field in diagnostics. */
  entityId?: string | null
  /** Custom field key, e.g. from `CustomFieldDef.key`. Used only to identify the field in diagnostics. */
  fieldKey?: string | null
}

export async function encryptCustomFieldValue(
  value: unknown,
  tenantId: string | null | undefined,
  service: TenantDataEncryptionService | null,
  cache?: Map<string | null, string | null>,
  options?: EncryptCustomFieldOptions,
): Promise<unknown> {
  if (value === undefined || value === null) return value
  const key = await resolveDekKey(service, tenantId, cache, { createIfMissing: true })
  if (!key) {
    // Key resolution failed for a field the operator configured as encrypted.
    // The write still goes through as plaintext (failing it would drop data on
    // a transient outage), but it must not be silent — issue #5921.
    if (isEncryptionExpected(service, tenantId)) warnOnPlaintextFallback(tenantId, options)
    return value
  }
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  return encryptWithAesGcm(serialized, key).value
}

export async function decryptCustomFieldValue(
  value: unknown,
  tenantId: string | null | undefined,
  service: TenantDataEncryptionService | null,
  cache?: Map<string | null, string | null>,
  options?: DecryptCustomFieldOptions,
): Promise<unknown> {
  if (value === undefined || value === null || typeof value !== 'string') return value
  const key = await resolveDekKey(service, tenantId, cache)
  if (!key) return value
  const decrypted = decryptWithAesGcm(value, key)
  if (decrypted === null) return value
  if (shouldPreserveAsString(options?.kind ?? null)) return decrypted
  try {
    return JSON.parse(decrypted)
  } catch {
    return decrypted
  }
}
