import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { normalizeAuthorUserId } from '@open-mercato/shared/lib/commands/helpers'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { ResourcesResource } from '../data/entities'

export { ensureOrganizationScope, ensureTenantScope, extractUndoPayload }

export async function requireResource(
  em: EntityManager,
  resourceId: string,
  message = 'Resource not found',
): Promise<ResourcesResource> {
  const resource = await em.findOne(ResourcesResource, { id: resourceId })
  if (!resource) throw new CrudHttpError(404, { error: message })
  return resource
}

export async function resolveResourceAuthorUserId(
  em: EntityManager,
  explicitAuthorUserId: string | undefined | null,
  ctx: CommandRuntimeContext,
  scope: { tenantId: string; organizationId: string },
): Promise<string | null> {
  const normalizedAuthor = normalizeAuthorUserId(explicitAuthorUserId, ctx.auth)
  const fallbackAuthor = normalizeAuthorUserId(null, ctx.auth)
  const isExplicitSuperAdminAuthor =
    Boolean(explicitAuthorUserId) &&
    normalizedAuthor === explicitAuthorUserId &&
    ctx.auth?.isApiKey !== true &&
    (ctx.auth as { isSuperAdmin?: boolean } | null)?.isSuperAdmin === true

  if (!isExplicitSuperAdminAuthor || !normalizedAuthor) return normalizedAuthor

  const author = await findOneWithDecryption(
    em,
    User,
    {
      id: normalizedAuthor,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )

  return author ? normalizedAuthor : fallbackAuthor
}
