import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
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

// `CustomerGroup.priority` carries a non-partial `(tenant_id, priority)` unique
// index (see data/entities.ts) — unlike most soft-delete-aware uniques in this
// module, it is NOT scoped to `deleted_at IS NULL`, so a stale/soft-deleted row
// can still collide with a newly assigned value. Surface that as a clean 409
// instead of letting the raw Postgres error reach the client as a 500.
const CUSTOMER_GROUP_PRIORITY_UNIQUE_CONSTRAINT = 'customer_groups_tenant_priority_unique'

const reorderCustomerGroupsCommand: CommandHandler<CustomerGroupReorderInput, void> = {
  id: 'customer_groups.groups.reorder',
  async execute(rawInput, ctx) {
    const parsed = customerGroupReorderSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // Load once, then rewrite priorities in a single atomic flush — mirrors
    // `customers.pipeline-stages.reorder` (`commands/pipeline-stages.ts`), the
    // template this command copies for the reorder-command/reorder-route shape.
    const groups = await em.find(CustomerGroup, {
      id: { $in: parsed.ids },
      tenantId: parsed.tenantId,
      deletedAt: null,
    })
    const groupMap = new Map(groups.map((group) => [group.id, group]))

    try {
      await withAtomicFlush(
        em,
        [
          () => {
            parsed.ids.forEach((id, index) => {
              const group = groupMap.get(id)
              // An id that no longer resolves to a group in this tenant (deleted or
              // never existed) is silently skipped, same as the pipeline-stage
              // reorder command's `if (!stage) continue`.
              if (!group) return
              group.priority = (index + 1) * PRIORITY_STEP
              group.updatedAt = new Date()
            })
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
  },
}

registerCommand(reorderCustomerGroupsCommand)

export { reorderCustomerGroupsCommand }
