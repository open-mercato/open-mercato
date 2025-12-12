import type { EntityManager } from '@mikro-orm/core'
import { encryptWithAesGcm, decryptWithAesGcm } from './aes'
import { TenantDataEncryptionService } from './tenantDataEncryptionService'

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
): Promise<string | null> {
  const scopedTenantId = tenantId ?? null
  if (!service || !service.isEnabled() || !scopedTenantId) return null
  if (cache?.has(scopedTenantId)) return cache.get(scopedTenantId) ?? null
  const dek = await service.getDek(scopedTenantId)
  const key = dek?.key ?? null
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
  const key = await resolveDekKey(service, tenantId, cache)
  if (!key) return value
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  return encryptWithAesGcm(serialized, key).value
}

export async function decryptCustomFieldValue(
  value: unknown,
  tenantId: string | null | undefined,
  service: TenantDataEncryptionService | null,
  cache?: Map<string | null, string | null>,
): Promise<unknown> {
  if (value === undefined || value === null || typeof value !== 'string') return value
  const key = await resolveDekKey(service, tenantId, cache)
  if (!key) return value
  const decrypted = decryptWithAesGcm(value, key)
  if (decrypted === null) return value
  try {
    return JSON.parse(decrypted)
  } catch {
    return decrypted
  }
}
