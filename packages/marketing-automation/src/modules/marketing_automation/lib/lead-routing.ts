import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { chooseAssignee } from './engine/lead-routing.js'
import type { RepDigest, RoutingDecision } from './engine/lead-routing.js'

/**
 * Lead routing: the rep pool, who is carrying what, and what each rep got this week.
 *
 * Assignment itself goes through `customers.people.update` — the owner is the customers module's field, and
 * writing it directly would skip the audit entry, the event and the cache invalidation that make an assignment
 * visible to the rest of the platform.
 */

export type RoutingScope = { tenantId: string; organizationId: string }

/** The config key holding the rep pool for this tenant. */
export const LEAD_ROUTING_CONFIG = 'leadRoutingUserIds'

type ModuleConfigLike = {
  getValue<T = unknown>(
    moduleId: string,
    name: string,
    options?: { defaultValue?: T | null; scope?: { tenantId?: string | null; organizationId?: string | null } },
  ): Promise<T | null>
}

/** The configured pool, or an empty one. Scope inside the options object — see `lib/tiers.ts`. */
export async function loadRoutingPool(
  container: AwilixContainer,
  scope: RoutingScope,
): Promise<string[]> {
  let service: ModuleConfigLike
  try {
    service = container.resolve<ModuleConfigLike>('moduleConfigService')
  } catch {
    return []
  }
  try {
    const value = await service.getValue<unknown>('marketing_automation', LEAD_ROUTING_CONFIG, { scope })
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  } catch {
    return []
  }
}

type LoadRow = { owner_user_id: string; total: string }

/**
 * How many live leads each rep owns.
 *
 * Counted across the whole organization rather than per campaign: a rep's capacity is not a per-campaign fact,
 * and routing one campaign evenly while another piles onto the same person is not routing.
 */
export async function loadOwnerLoad(
  em: EntityManager,
  scope: RoutingScope,
  userIds: string[],
): Promise<Record<string, number>> {
  if (userIds.length === 0) return {}
  const placeholders = userIds.map(() => '?').join(', ')
  const rows = await em.getConnection().execute<LoadRow[]>(
    `select owner_user_id, count(*)::text as total
       from customer_entities
      where tenant_id = ? and organization_id = ?
        and deleted_at is null
        and kind = 'person'
        and owner_user_id in (${placeholders})
      group by owner_user_id`,
    [scope.tenantId, scope.organizationId, ...userIds],
  )
  const load: Record<string, number> = {}
  for (const row of rows) load[row.owner_user_id] = Number.parseInt(row.total ?? '0', 10) || 0
  return load
}

/** The routing decision for one lead, with the pool and the load read for it. */
export async function decideAssignment(
  em: EntityManager,
  container: AwilixContainer,
  scope: RoutingScope,
  input: { subjectEntityId: string; reassign?: boolean },
): Promise<RoutingDecision> {
  const pool = await loadRoutingPool(container, scope)
  if (pool.length === 0) return { assign: false, reason: 'empty_pool' }

  const customer = await em.findOne(CustomerEntity, { id: input.subjectEntityId, ...scope, deletedAt: null })
  const load = await loadOwnerLoad(em, scope, pool)

  return chooseAssignee({
    pool,
    load,
    currentOwnerUserId: customer?.ownerUserId ?? null,
    reassign: input.reassign,
  })
}

/**
 * What each rep in the pool received since a given moment.
 *
 * Display names are read through the DECRYPTING finder: they are encrypted at rest, and a digest listing
 * ciphertext would be worse than no digest.
 */
export async function buildRepDigests(
  em: EntityManager,
  scope: RoutingScope,
  pool: string[],
  since: Date,
): Promise<RepDigest[]> {
  if (pool.length === 0) return []

  const load = await loadOwnerLoad(em, scope, pool)

  /**
   * "New this week" is by CREATION, not by assignment.
   *
   * The owner column carries no history — an assignment date would need one — so this reports the leads that
   * arrived in the window and belong to the rep now. Stated plainly in the digest copy rather than dressed up
   * as an assignment log.
   */
  const rows = (await findWithDecryption(
    em,
    CustomerEntity,
    {
      ...scope,
      kind: 'person',
      deletedAt: null,
      ownerUserId: { $in: pool },
      createdAt: { $gte: since },
    },
    { orderBy: { createdAt: 'DESC' }, limit: 200 },
    scope,
  )) as Array<{ id: string; displayName?: string | null; ownerUserId?: string | null }>

  const byOwner = new Map<string, Array<{ id: string; displayName: string }>>()
  for (const row of rows) {
    if (!row.ownerUserId) continue
    const list = byOwner.get(row.ownerUserId) ?? []
    // Ten is a digest; a hundred is a report somebody has to open anyway.
    if (list.length < 10) list.push({ id: row.id, displayName: row.displayName ?? row.id })
    byOwner.set(row.ownerUserId, list)
  }

  return pool.map((userId) => ({
    userId,
    newLeads: byOwner.get(userId) ?? [],
    totalOwned: load[userId] ?? 0,
  }))
}
