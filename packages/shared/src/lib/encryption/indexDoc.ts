import { decryptCustomFieldValue } from './customFieldValues'
import type { TenantDataEncryptionService } from './tenantDataEncryptionService'

export type IndexDocScope = {
  tenantId: string | null
  organizationId?: string | null
}

async function decryptValue(
  value: unknown,
  scope: IndexDocScope,
  service: TenantDataEncryptionService | null,
  cache?: Map<string | null, string | null>,
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => decryptCustomFieldValue(entry, scope.tenantId, service, cache)))
  }
  return decryptCustomFieldValue(value, scope.tenantId, service, cache)
}

export async function decryptIndexDocCustomFields(
  doc: Record<string, unknown>,
  scope: IndexDocScope,
  service: TenantDataEncryptionService | null,
  cache?: Map<string | null, string | null>,
): Promise<Record<string, unknown>> {
  // HybridQueryEngine aliases cf keys as `cf_<key>` (sanitized), while index docs use `cf:<key>`.
  // Support both shapes to keep decryption consistent across query paths.
  const keys = Object.keys(doc).filter((key) => key.startsWith('cf:') || key.startsWith('cf_'))
  if (!keys.length) return doc

  const working: Record<string, unknown> = { ...doc }
  await Promise.all(
    keys.map(async (key) => {
      try {
        working[key] = await decryptValue(working[key], scope, service, cache)
      } catch {
        // ignore; keep original value
      }
    }),
  )
  return working
}

export async function decryptIndexDocForSearch(
  entityId: string,
  doc: Record<string, unknown>,
  scope: IndexDocScope,
  service: TenantDataEncryptionService | null,
  cache?: Map<string | null, string | null>,
): Promise<Record<string, unknown>> {
  if (!service || typeof service.decryptEntityPayload !== 'function') {
    return decryptIndexDocCustomFields(doc, scope, service, cache)
  }
  if (service.isEnabled?.() === false) {
    return decryptIndexDocCustomFields(doc, scope, service, cache)
  }

  let working: Record<string, unknown> = doc
  const decryptEntity = async (targetEntityId: string) => {
    const decrypted = await service.decryptEntityPayload(
      targetEntityId,
      working,
      scope.tenantId ?? null,
      scope.organizationId ?? null,
    )
    working = { ...working, ...decrypted }
  }

  await decryptEntity(entityId)
  if (entityId === 'customers:customer_person_profile' || entityId === 'customers:customer_company_profile') {
    await decryptEntity('customers:customer_entity')
  }

  return decryptIndexDocCustomFields(working, scope, service, cache)
}

export async function encryptIndexDocForStorage(
  entityId: string,
  doc: Record<string, unknown>,
  scope: IndexDocScope,
  service: TenantDataEncryptionService | null,
): Promise<Record<string, unknown>> {
  if (!service || typeof service.encryptEntityPayload !== 'function') return doc
  if (service.isEnabled?.() === false) return doc

  let working: Record<string, unknown> = doc
  const encryptEntity = async (targetEntityId: string) => {
    const encrypted = await service.encryptEntityPayload(
      targetEntityId,
      working,
      scope.tenantId ?? null,
      scope.organizationId ?? null,
    )
    working = { ...working, ...encrypted }
  }

  await encryptEntity(entityId)
  if (entityId === 'customers:customer_person_profile' || entityId === 'customers:customer_company_profile') {
    await encryptEntity('customers:customer_entity')
  }

  return working
}
