import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { resolveVerifiedSessionKeyUserId } from '@open-mercato/core/modules/api_keys/services/sessionKeyRoles'

export type ApiKeyPrincipal = {
  principalApiKeyId?: string
  apiKeyUserId?: string
}

/**
 * Returns the authenticated key ID and, for a session-bound key, its verified
 * user ID. Attachment owner checks use these IDs to identify the same
 * principal as authentication. Cookie sessions return an empty principal.
 */
export async function resolveToolPrincipalIds(
  container: AwilixContainer,
  auth: AuthContext,
): Promise<ApiKeyPrincipal> {
  if (!auth?.isApiKey || typeof auth.keyId !== 'string' || auth.keyId.length === 0) return {}
  const em = container.resolve<EntityManager>('em')
  const tenantId = auth.tenantId ?? null
  const organizationId = auth.orgId ?? null
  const key = await findOneWithDecryption(
    em,
    ApiKey,
    { id: auth.keyId, deletedAt: null, tenantId, organizationId },
    undefined,
    { tenantId, organizationId },
  )
  const keyMatchesScope = key !== null
    && (key.tenantId ?? null) === tenantId
    && (key.organizationId ?? null) === organizationId
  const apiKeyUserId = keyMatchesScope ? await resolveVerifiedSessionKeyUserId(em, key) : null
  return { principalApiKeyId: auth.keyId, ...(apiKeyUserId ? { apiKeyUserId } : {}) }
}
