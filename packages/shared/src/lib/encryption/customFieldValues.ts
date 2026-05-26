import type { EntityManager } from '@mikro-orm/core'
import { encryptWithAesGcm, decryptWithAesGcm } from './aes'
import { TenantDataEncryptionService } from './tenantDataEncryptionService'

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

export async function encryptCustomFieldValue(
  value: unknown,
  tenantId: string | null | undefined,
  service: TenantDataEncryptionService | null,
  cache?: Map<string | null, string | null>,
): Promise<unknown> {
  if (value === undefined || value === null) return value
  const key = await resolveDekKey(service, tenantId, cache, { createIfMissing: true })
  if (!key) return value
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
