import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  ApiKeyOneTimeIssuer,
  IssueOneTimeApiKeyInput,
} from '@open-mercato/shared/lib/auth/principal-service'
import { withOnetimeApiKey } from './apiKeyService'

export type { ApiKeyOneTimeIssuer, IssueOneTimeApiKeyInput }

export class DefaultApiKeyOneTimeIssuer implements ApiKeyOneTimeIssuer {
  constructor(private readonly em: EntityManager) {}

  async withOneTimeApiKey<T>(
    input: IssueOneTimeApiKeyInput,
    callback: (secret: string) => Promise<T>,
  ): Promise<T> {
    const tenantId = typeof input.tenantId === 'string' ? input.tenantId.trim() : ''
    if (!tenantId) {
      throw new Error('One-time API key issuance requires a non-empty tenantId.')
    }
    const roleIds = Array.from(
      new Set(
        (input.roles ?? [])
          .map((roleId) => (typeof roleId === 'string' ? roleId.trim() : ''))
          .filter(Boolean),
      ),
    )
    if (roleIds.length === 0) {
      throw new Error('One-time API key issuance requires at least one authorized role ID.')
    }

    const organizationId =
      typeof input.organizationId === 'string' ? (input.organizationId.trim() || null) : null
    const name = typeof input.name === 'string' ? input.name.trim() : ''

    // Fork a context-detached EntityManager so key creation and soft-delete cleanup
    // commit on their own pooled connection outside any surrounding caller transaction.
    const isolatedEm = this.em.fork({
      clear: true,
      freshEventManager: true,
      useContext: false,
    }) as EntityManager

    return withOnetimeApiKey(
      isolatedEm,
      {
        name,
        description: input.description ?? null,
        tenantId,
        organizationId,
        roles: roleIds,
        expiresAt: input.expiresAt ?? null,
      },
      callback,
    )
  }
}

export function createApiKeyOneTimeIssuer(em: EntityManager): ApiKeyOneTimeIssuer {
  return new DefaultApiKeyOneTimeIssuer(em)
}
