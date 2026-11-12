import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ApiKey } from '@open-mercato/core/modules/api_keys/data/entities'
import { resolveVerifiedSessionKeyUserId } from '@open-mercato/core/modules/api_keys/services/sessionKeyRoles'

export type ApiKeyPrincipal = {
  apiKeyId?: string
  apiKeyUserId?: string
}

/**
 * Identifies the key behind a key-authenticated request and, for a session-bound key,
 * the verified user it acts for, so attachment owner access checks evaluate the same
 * principal API-key authentication produced. Cookie sessions return an empty principal.
 */
export async function resolveRequestApiKeyPrincipal(
  container: AwilixContainer,
  auth: AuthContext,
): Promise<ApiKeyPrincipal> {
  if (!auth?.isApiKey || typeof auth.keyId !== 'string' || auth.keyId.length === 0) return {}
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null }
  const key = await findOneWithDecryption(em, ApiKey, { id: auth.keyId, deletedAt: null }, undefined, scope)
  const apiKeyUserId = key ? await resolveVerifiedSessionKeyUserId(em, key) : null
  return { apiKeyId: auth.keyId, ...(apiKeyUserId ? { apiKeyUserId } : {}) }
}
