import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureOrganizationScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ResourcesResource } from '../data/entities'

export function ensureTenantScope(ctx: CommandRuntimeContext, tenantId: string): void {
  const currentTenant = ctx.auth?.tenantId ?? null
  if (currentTenant && currentTenant !== tenantId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

export { ensureOrganizationScope, extractUndoPayload }

export async function requireResource(
  em: EntityManager,
  resourceId: string,
  message = 'Resource not found',
): Promise<ResourcesResource> {
  const resource = await em.findOne(ResourcesResource, { id: resourceId })
  if (!resource) throw new CrudHttpError(404, { error: message })
  return resource
}
