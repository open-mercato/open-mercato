import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { canonicalizeResourceTag, invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { conflict, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CustomerGroup } from '../data/entities'
import { customerGroupReorderSchema, type CustomerGroupReorderInput } from '../data/validators'

// Spec §14 Phase 1, R4 mitigation: "Import assigns priorities in gaps of 10 and
// renumbers on conflict; the admin list supports drag-reorder which rewrites
// priorities in one transaction." Gaps of 10 leave room for a future import or
// manual reprioritization to slot a group between two existing ones without
// renumbering the whole tenant.
const PRIORITY_STEP = 10

// `CustomerGroup.priority` carries the partial unique index
// `(tenant_id, priority) WHERE deleted_at IS NULL` (see data/entities.ts). It is a
// unique INDEX, so it can never be DEFERRABLE, and Postgres checks it row by row
// while a statement runs — not at statement or transaction end. Writing the final
// priorities straight over the current ones therefore collides on any swap
// (A 10→20 while B still holds 20). Any remaining unique violation (a concurrent
// create/adopt/reorder that landed between our read and our write) is surfaced as a
// clean 409 instead of a raw 500.
const CUSTOMER_GROUP_PRIORITY_UNIQUE_CONSTRAINT = 'customer_groups_tenant_priority_unique'

// The group list route's CRUD cache resource kind. `customer_groups.group` is the
// events-derived kind; `CustomerGroup` is the entity-name-derived fallback
// `makeCrudRoute` uses when no `events` config is declared — both are flushed so the
// admin list never serves pre-reorder priorities whichever one the route resolves to.
const CUSTOMER_GROUP_CACHE_RESOURCE = canonicalizeResourceTag('customer_groups.group') ?? 'customer_groups.group'
const CUSTOMER_GROUP_CACHE_ALIASES = [canonicalizeResourceTag('CustomerGroup') ?? 'customer.group']

type PriorityAssignment = { group: CustomerGroup; temporary: number; final: number }

/**
 * Computes the final priority for every listed group that resolves in the tenant.
 *
 * Two documented regimes, chosen so the result can never collide with a group
 * that is NOT being rewritten:
 * - Full ordering (the listed ids cover every non-deleted group in the tenant — what
 *   the admin list sends on its unfiltered view): priorities are renumbered to
 *   `(position + 1) * PRIORITY_STEP` following the list order. Every row in the
 *   tenant is rewritten, so nothing outside the list can hold one of those values.
 * - Partial ordering (any other non-deleted group is left out): the listed groups
 *   are reordered among the priority values they ALREADY hold (sorted ascending and
 *   handed out in list order). Groups outside the list keep their priority untouched
 *   and their precedence relative to the listed ones is unchanged, so a partial
 *   reorder never silently renumbers — or collides with — a group the caller did not
 *   mention, and replaying the previous order restores the exact previous values.
 *
 * Unknown / other-tenant / soft-deleted ids are skipped (still consuming their
 * position in the full-ordering regime); duplicate ids keep their first position.
 */
function planPriorityAssignments(ids: string[], tenantGroups: CustomerGroup[]): PriorityAssignment[] {
  const groupsById = new Map(tenantGroups.map((group) => [group.id, group]))
  const positions = new Map<string, number>()
  ids.forEach((id, index) => {
    if (!positions.has(id)) positions.set(id, index)
  })
  const targets = Array.from(positions.keys())
    .map((id) => groupsById.get(id))
    .filter((group): group is CustomerGroup => Boolean(group))
  if (!targets.length) return []

  const isFullOrdering = targets.length === tenantGroups.length
  const ownSlots = targets.map((group) => group.priority).sort((left, right) => left - right)

  // Temporary values sit strictly below every priority currently held in the tenant
  // (including adopted orphans, which live below the tenant minimum — see
  // `lib/reconcile.ts` `adoptOrphanedCustomerGroups`) and are distinct from each
  // other, so the first write pass can never hit the unique index.
  const tenantMinimum = tenantGroups.reduce((min, group) => Math.min(min, group.priority), 0)
  const temporaryBase = tenantMinimum - 1

  return targets.map((group, index) => ({
    group,
    temporary: temporaryBase - index,
    final: isFullOrdering ? ((positions.get(group.id) ?? index) + 1) * PRIORITY_STEP : ownSlots[index],
  }))
}

const reorderCustomerGroupsCommand: CommandHandler<CustomerGroupReorderInput, void> = {
  id: 'customer_groups.groups.reorder',
  async execute(rawInput, ctx) {
    const parsed = customerGroupReorderSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Every non-deleted group in the tenant: needed to decide the full vs. partial
    // regime and to pick temporary values that cannot collide with any row the
    // partial unique index covers.
    const tenantGroups = await em.find(CustomerGroup, { tenantId: parsed.tenantId, deletedAt: null })
    const assignments = planPriorityAssignments(parsed.ids, tenantGroups)
    if (!assignments.length) return

    try {
      // Two phases, each flushed inside ONE transaction by `withAtomicFlush`: park the
      // rewritten rows on temporary values first, then write the final values once
      // no listed row still occupies a slot another listed row needs.
      await withAtomicFlush(
        em,
        [
          () => {
            for (const assignment of assignments) {
              assignment.group.priority = assignment.temporary
            }
          },
          () => {
            const now = new Date()
            for (const assignment of assignments) {
              assignment.group.priority = assignment.final
              assignment.group.updatedAt = now
            }
          },
        ],
        { transaction: true, label: 'customer_groups.groups.reorder' },
      )
    } catch (err) {
      if (isUniqueViolation(err, CUSTOMER_GROUP_PRIORITY_UNIQUE_CONSTRAINT) || isUniqueViolation(err)) {
        const { translate } = await resolveTranslations()
        throw conflict(
          translate(
            'customer_groups.errors.reorderConflict',
            'Another change affected group priorities. Reload and try again.',
          ),
        )
      }
      throw err
    }

    for (const assignment of assignments) {
      await invalidateCrudCache(
        ctx.container,
        CUSTOMER_GROUP_CACHE_RESOURCE,
        { id: assignment.group.id, tenantId: parsed.tenantId, organizationId: null },
        parsed.tenantId,
        'updated',
        CUSTOMER_GROUP_CACHE_ALIASES,
      )
    }
  },
}

registerCommand(reorderCustomerGroupsCommand)

export { reorderCustomerGroupsCommand }
