import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'

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
 * Wrap `plaintext` as `{ [ref.field]: plaintext }` and encrypt it under the
 * tenant DEK, returning the sealed wrapper — or `null` when the field did not
 * come back as an AES-GCM envelope. `TenantDataEncryptionService` passes the
 * payload through unchanged when encryption is disabled, no map covers the
 * entity, or no DEK can be resolved; an artifact offloaded to object storage
 * must never be written in that state, so callers skip the upload on `null`.
 */
export async function sealArtifactPayload(
  service: ArtifactSealingService | null,
  scope: ArtifactSealScope,
  ref: ArtifactSealRef,
  plaintext: string,
): Promise<Record<string, unknown> | null> {
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
