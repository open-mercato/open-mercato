import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { EntityManager } from '@mikro-orm/postgresql'
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
