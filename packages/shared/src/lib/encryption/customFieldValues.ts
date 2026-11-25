import type { EntityManager } from '@mikro-orm/core'
import { CrudHttpError } from '../crud/errors'
import { createLogger } from '../logger'
import { encryptWithAesGcm, decryptWithAesGcm } from './aes'
import { TenantDataEncryptionService } from './tenantDataEncryptionService'
import { isTenantDataEncryptionEnabled } from './toggles'

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
  if (cache?.has(scopedTenantId)) {
    const cached = cache.get(scopedTenantId) ?? null
    if (cached || !opts?.createIfMissing) return cached
  }
  const dek = await service.getDek(scopedTenantId)
  let key = dek?.key ?? null
  if (!key && opts?.createIfMissing && typeof service.createDek === 'function') {
    const created = await service.createDek(scopedTenantId)
    key = created?.key ?? null
  }
  cache?.set(scopedTenantId, key)
  return key
}

// Throttle rejection warnings by tenant, entity and field until the tenant's key recovers.
const ENCRYPTION_UNAVAILABLE_WARN_CAP = 5000
const unavailableWarnings = new Set<string>()

/** Test seam for the process-global write warning cache. */
export function resetEncryptedFieldPlaintextFallbackWarnCache(): void {
  unavailableWarnings.clear()
}

function clearEncryptionUnavailableWarnings(tenantId: string): void {
  if (!unavailableWarnings.size) return
  const prefix = `${tenantId}|`
  for (const warnKey of unavailableWarnings) {
    if (warnKey.startsWith(prefix)) unavailableWarnings.delete(warnKey)
  }
}

function warnOnEncryptionUnavailable(tenantId: string, options?: EncryptCustomFieldOptions): void {
  try {
    const entity = options?.entityId ?? null
    const field = options?.fieldKey ?? null
    const warnKey = `${tenantId}|${entity ?? 'unknown'}|${field ?? 'unknown'}`
    if (unavailableWarnings.has(warnKey)) return
    if (unavailableWarnings.size >= ENCRYPTION_UNAVAILABLE_WARN_CAP) {
      const oldest = unavailableWarnings.values().next().value
      if (oldest !== undefined) unavailableWarnings.delete(oldest)
    }
    unavailableWarnings.add(warnKey)
    logger.warn('Encrypted custom field write rejected because the tenant key is unavailable', {
      tenantId,
      entity,
      field,
      hint: 'Restore tenant encryption key access and retry the write.',
    })
  } catch {
    // Preserve the write error if the diagnostic fails.
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
  if (value === undefined || value === null || !tenantId || !isTenantDataEncryptionEnabled()) return value

  let key: string | null = null
  let cause: unknown
  try {
    key = await resolveDekKey(service, tenantId, cache, { createIfMissing: true })
  } catch (error) {
    cause = error
  }
  if (!key) {
    warnOnEncryptionUnavailable(tenantId, options)
    throw new CrudHttpError(503, {
      error: 'api.errors.serviceUnavailable',
      code: 'ENCRYPTION_UNAVAILABLE',
    }, { cause })
  }
  clearEncryptionUnavailableWarnings(tenantId)
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
