import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'

/**
 * Document-aggregate optimistic lock for `ProductionOrder` sub-resources
 * (operations, materials) — mirrors `packages/core/src/modules/sales/commands/shared.ts`
 * `enforceSalesDocumentOptimisticLock`. The parent order is the consistency
 * boundary: any sub-resource mutation (release copying snapshot rows, a
 * report against an operation, etc.) transitions/dirties the order, so its
 * `updated_at` advances on flush and concurrent edits observe each other.
 *
 * Call this AFTER loading + scope-checking the order and BEFORE mutating, so
 * `order.updatedAt` is the pre-mutation version. Strictly additive: a no-op
 * when the client sends no optimistic-lock header (existing consumers are
 * unaffected). Respects `OM_OPTIMISTIC_LOCK`.
 */
export const PRODUCTION_ORDER_RESOURCE_KIND = 'production.order'

export async function enforceProductionOrderOptimisticLock(
  ctx: CommandRuntimeContext,
  order: { id: string; updatedAt?: Date | string | null } | null | undefined,
): Promise<void> {
  if (!order) return
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: PRODUCTION_ORDER_RESOURCE_KIND,
    resourceId: order.id,
    current: order.updatedAt ?? null,
    request: ctx.request ?? null,
  })
}
