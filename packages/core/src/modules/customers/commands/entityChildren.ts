import { LockMode } from '@mikro-orm/core'
import type { EntityManager, EntityName } from '@mikro-orm/postgresql'
import { E } from '#generated/entities.ids.generated'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  CustomerActivity,
  CustomerAddress,
  CustomerComment,
  CustomerInteraction,
  CustomerTagAssignment,
  CustomerTodoLink,
  type CustomerEntity,
} from '../data/entities'
import { emitQueryIndexDeleteEvents, type QueryIndexEventEntry } from './shared'

type EntityChild = { id: string; entity: CustomerEntity; tenantId: string; organizationId: string }

const indexedChildren: ReadonlyArray<readonly [EntityName<EntityChild>, string]> = [
  [CustomerActivity, E.customers.customer_activity],
  [CustomerAddress, E.customers.customer_address],
  [CustomerComment, E.customers.customer_comment],
  [CustomerInteraction, E.customers.customer_interaction],
  [CustomerTodoLink, E.customers.customer_todo_link],
]

export async function loadEntityChildIndexEntries(
  em: EntityManager,
  entity: CustomerEntity,
): Promise<QueryIndexEventEntry[]> {
  const scope = { tenantId: entity.tenantId, organizationId: entity.organizationId }
  const entries: QueryIndexEventEntry[] = []
  for (const [child, entityType] of indexedChildren) {
    const records = await findWithDecryption(
      em, child, { entity, ...scope }, { fields: ['id'], lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } }, scope,
    )
    for (const record of records) entries.push({ entityType, recordId: record.id, ...scope })
  }
  return entries
}

export async function removeEntityChildren(em: EntityManager, entity: CustomerEntity): Promise<void> {
  const where = { entity, tenantId: entity.tenantId, organizationId: entity.organizationId }
  for (const [child] of indexedChildren) {
    await em.nativeDelete(child, where)
  }
  await em.nativeDelete(CustomerTagAssignment, where)
}

export async function emitEntityChildDeleteEffects(
  ctx: CommandRuntimeContext,
  entity: CustomerEntity,
  entries: QueryIndexEventEntry[],
): Promise<void> {
  await emitQueryIndexDeleteEvents(ctx, entries)
  const deletedTypes = new Set(entries.map((entry) => entry.entityType))
  const scope = { tenantId: entity.tenantId, organizationId: entity.organizationId }
  const resources = [
    [E.customers.customer_address, 'customers.address'],
    [E.customers.customer_comment, 'customers.comment'],
  ] as const
  for (const [entityType, resource] of resources) {
    if (!deletedTypes.has(entityType)) continue
    try {
      await invalidateCrudCache(ctx.container, resource, scope, entity.tenantId, 'customer create undo', [entityType])
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, { module: 'customers', code: 'customers.undo_child_cache_invalidation_failed' })
    }
  }
}

export async function requireEntityCleanupAccess(
  em: EntityManager,
  entity: CustomerEntity,
  ctx: CommandRuntimeContext,
  feature: 'customers.people.manage' | 'customers.companies.manage',
): Promise<void> {
  if (!ctx.auth && ctx.systemActor === true) return
  const actorId = ctx.auth?.sub
  const rbac = ctx.container.resolve<RbacService>('rbacService', { allowUnregistered: true })
  if (!actorId || !rbac || !await rbac.userHasAllFeaturesWithEntityManager(em, actorId, [feature], {
    tenantId: entity.tenantId,
    organizationId: entity.organizationId,
  })) throw forbidden()
}
