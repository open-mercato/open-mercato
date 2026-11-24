import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

const UPLOAD_PROVENANCE_KEY = '__openMercatoUpload'

export function withUploadProvenance(
  metadata: Record<string, unknown> | null | undefined,
  auth: NonNullable<AuthContext>,
): Record<string, unknown> {
  return {
    ...metadata,
    [UPLOAD_PROVENANCE_KEY]: {
      principalId: auth.sub,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    },
  }
}

export function hasUploadProvenance(
  metadata: unknown,
  auth: NonNullable<AuthContext>,
): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const provenance = (metadata as Record<string, unknown>)[UPLOAD_PROVENANCE_KEY]
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) return false
  const value = provenance as Record<string, unknown>
  return Boolean(auth.sub && auth.tenantId && auth.orgId)
    && value.principalId === auth.sub
    && value.tenantId === auth.tenantId
    && value.organizationId === auth.orgId
}
