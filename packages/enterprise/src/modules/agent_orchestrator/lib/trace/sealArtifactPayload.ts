import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'

export type ArtifactSealingService = {
  encryptEntityPayload(
    entityId: string,
    payload: Record<string, unknown>,
    tenantId: string | null | undefined,
    organizationId?: string | null,
  ): Promise<Record<string, unknown>>
}

export type ArtifactSealRef = { entityId: string; field: string }

export type ArtifactSealScope = { tenantId: string; organizationId: string }

/**
 * Wrap `plaintext` as `{ [ref.field]: plaintext }` for upload to object storage.
 *
 * When the operator turned tenant data encryption off (`TENANT_DATA_ENCRYPTION`
 * false), the wrapper is returned as plaintext, consistent with how every other
 * encrypted column is stored in that mode. When encryption is on, the wrapper
 * is encrypted under the tenant DEK and returned only if the field came back as
 * an AES-GCM envelope; otherwise `null`. `TenantDataEncryptionService` passes
 * the payload through unchanged when the KMS is unhealthy, no map covers the
 * entity, or no DEK can be resolved, so with encryption on such a payload must
 * never be uploaded and callers skip the upload on `null`.
 */
export async function sealArtifactPayload(
  service: ArtifactSealingService | null,
  scope: ArtifactSealScope,
  ref: ArtifactSealRef,
  plaintext: string,
): Promise<Record<string, unknown> | null> {
  if (!isTenantDataEncryptionEnabled()) return { [ref.field]: plaintext }
  if (!service || typeof service.encryptEntityPayload !== 'function') return null
  const sealed = await service.encryptEntityPayload(
    ref.entityId,
    { [ref.field]: plaintext },
    scope.tenantId,
    scope.organizationId,
  )
  const value = sealed?.[ref.field]
  if (value === plaintext || !isEncryptedPayloadShape(value)) return null
  return sealed
}
