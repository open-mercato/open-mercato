import { decryptWithAesGcm, isEncryptedPayloadShape, TenantDataEncryptionError, TenantDataEncryptionErrorCode } from './aes'
import { decryptCustomFieldValue, encryptCustomFieldValue } from './customFieldValues'
import type { TenantDataEncryptionService } from './tenantDataEncryptionService'
import { isTenantDataEncryptionEnabled } from './toggles'

/** @internal */
export type CustomEntityDocumentField = { key: string; kind: string | null; encrypted: boolean }

function fieldKey(key: string): string {
  return key.replace(/^cf[:_]/, '')
}

/** @internal */
export function isCustomEntityDocumentCiphertext(value: unknown): value is string {
  return isEncryptedPayloadShape(value) || (typeof value === 'string' && /^[A-Za-z0-9+/]{16}::[A-Za-z0-9+/]{22}==:v1$/.test(value))
}

/** @internal */
export async function encryptCustomEntityDocument(
  doc: Record<string, unknown>,
  fields: readonly CustomEntityDocumentField[],
  tenantId: string | null,
  service: TenantDataEncryptionService | null,
): Promise<Record<string, unknown>> {
  if (!isTenantDataEncryptionEnabled()) return doc
  const protectedKeys = new Set(fields.filter((field) => field.encrypted).map((field) => field.key))
  const entries = Object.entries(doc).filter(([key, value]) => protectedKeys.has(fieldKey(key)) && value != null)
  if (!entries.length) return doc
  if (!tenantId || !service?.isEnabled()) {
    throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.KMS_UNAVAILABLE, '[internal] Custom entity encryption requires an available tenant key')
  }
  const dek = await service.getDek(tenantId) ?? await service.createDek(tenantId)
  if (!dek) {
    throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.KMS_UNAVAILABLE, '[internal] Custom entity encryption key is unavailable')
  }
  const cache = new Map<string | null, string | null>([[tenantId, dek.key]])
  const encrypt = async (value: unknown): Promise<unknown> => {
    if (typeof value === 'string' && decryptWithAesGcm(value, dek.key) !== null) return value
    if (isCustomEntityDocumentCiphertext(value)) {
      throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.WRONG_KEY, '[internal] Custom entity ciphertext does not decrypt under the current tenant key')
    }
    const encrypted = await encryptCustomFieldValue(value, tenantId, service, cache)
    if (value != null && (typeof encrypted !== 'string' || decryptWithAesGcm(encrypted, dek.key) === null)) {
      throw new TenantDataEncryptionError(TenantDataEncryptionErrorCode.KMS_UNAVAILABLE, '[internal] Custom entity field could not be encrypted')
    }
    return encrypted
  }
  const next = { ...doc }
  for (const [key, value] of entries) {
    next[key] = Array.isArray(value) ? await Promise.all(value.map(encrypt)) : await encrypt(value)
  }
  return next
}

/** @internal */
export async function decryptCustomEntityDocument(
  doc: Record<string, unknown>,
  fields: readonly CustomEntityDocumentField[],
  tenantId: string | null,
  service: TenantDataEncryptionService | null,
  cache = new Map<string | null, string | null>(),
): Promise<Record<string, unknown>> {
  const byKey = new Map(fields.map((field) => [field.key, field]))
  const next = { ...doc }
  for (const [key, value] of Object.entries(doc)) {
    const field = byKey.get(fieldKey(key))
    if (!field) continue
    const decrypt = (entry: unknown) => decryptCustomFieldValue(entry, tenantId, service, cache, { kind: field.kind })
    next[key] = Array.isArray(value) ? await Promise.all(value.map(decrypt)) : await decrypt(value)
  }
  return next
}
