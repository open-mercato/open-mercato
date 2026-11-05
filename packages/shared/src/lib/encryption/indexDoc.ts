import { decryptCustomFieldValue } from './customFieldValues'
import { resolveCustomFieldKind, type CustomFieldKindMap } from '../custom-fields/kinds'
import type { TenantDataEncryptionService } from './tenantDataEncryptionService'

export type IndexDocScope = {
  tenantId: string | null
  organizationId?: string | null
}

async function decryptValue(
  value: unknown,
  scope: IndexDocScope,
  service: TenantDataEncryptionService | null,
  cache: Map<string | null, string | null> | undefined,
  kind: string | null,
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((entry) => decryptCustomFieldValue(entry, scope.tenantId, service, cache, { kind })),
    )
  }
  return decryptCustomFieldValue(value, scope.tenantId, service, cache, { kind })
}

export async function decryptIndexDocCustomFields(
  doc: Record<string, unknown>,
  scope: IndexDocScope,
  service: TenantDataEncryptionService | null,
  cache?: Map<string | null, string | null>,
  kinds?: CustomFieldKindMap | null,
): Promise<Record<string, unknown>> {
  // HybridQueryEngine aliases cf keys as `cf_<key>` (sanitized), while index docs use `cf:<key>`.
  // Support both shapes to keep decryption consistent across query paths.
  const keys = Object.keys(doc).filter((key) => key.startsWith('cf:') || key.startsWith('cf_'))
  if (!keys.length) return doc

  const working: Record<string, unknown> = { ...doc }
  await Promise.all(
    keys.map(async (key) => {
      try {
        // Without the field's kind, `decryptCustomFieldValue` falls back to `JSON.parse` and
        // retypes string-typed values whose plaintext looks like JSON — `"123"` becomes 123
        // and `"true"` becomes true (issue #5968). An unresolved kind keeps the legacy path.
        working[key] = await decryptValue(working[key], scope, service, cache, resolveCustomFieldKind(kinds, key))
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
  kinds?: CustomFieldKindMap | null,
): Promise<Record<string, unknown>> {
  if (!service || typeof service.decryptEntityPayload !== 'function') {
    return decryptIndexDocCustomFields(doc, scope, service, cache, kinds)
  }
  if (service.isEnabled?.() === false) {
    return decryptIndexDocCustomFields(doc, scope, service, cache, kinds)
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

  return decryptIndexDocCustomFields(working, scope, service, cache, kinds)
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
