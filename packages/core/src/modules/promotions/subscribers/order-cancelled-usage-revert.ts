import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { PromotionCodeService, type PromotionsCodeScope } from '../lib/code-service'
import { PromotionUsageService } from '../lib/promotion-usage-service'

const logger = createLogger('promotions').child({ component: 'order-cancelled-usage-revert' })

// Release 5 C5/SPEC-055 amendment (finding C5): "`sales` cannot depend on `promotions`
// and nothing subscribes" to the old `§3.3 'sales calls revertUsage'` text — withdrawn.
// This is the promotions-owned replacement: a persistent subscriber on
// `sales.order.cancelled` that reverses BOTH halves of what checkout's future submit
// sequence (Phase 4, Step 4.2) will have recorded for the order — the promotion-budget
// ledger (`revertUsage`, existing) and the code-usage/redemption-counter state
// (`revertCodeUse`, additive, this Step). Reads only the FK ids off the event payload,
// never imports a `sales` entity (AGENTS.md: upstream never depends on downstream).
//
// Idempotent by construction: `revertUsage` only touches `PromotionUsage` rows with
// `revertedAt IS NULL` and `revertCodeUse` only touches `CodeUsage` rows with
// `revertedAt IS NULL` — a redelivered event finds nothing left to revert on the second
// pass, same no-op-on-redelivery precedent as `customer_groups`'s own
// `order-cancelled-credit-release` subscriber for this exact event.
export const metadata = {
  event: 'sales.order.cancelled',
  persistent: true,
  id: 'promotions:order-cancelled-usage-revert',
}

type ResolverContainer = {
  resolve: <T = unknown>(name: string) => T
}

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function resolveContainer(ctx: SubscriberContext): ResolverContainer {
  return ctx.container ?? { resolve: ctx.resolve }
}

export default async function handle(payload: unknown, ctx: SubscriberContext): Promise<void> {
  const record = toRecord(payload)
  const orderId = readString(record, 'orderId') ?? readString(record, 'id')
  const tenantId = readString(record, 'tenantId') ?? ctx.tenantId ?? null
  const organizationId = readString(record, 'organizationId') ?? ctx.organizationId ?? null

  if (!orderId || !tenantId || !organizationId) {
    logger.debug('[internal] promotions:order-cancelled-usage-revert skipped incomplete payload', {
      hasOrderId: Boolean(orderId),
      hasTenantId: Boolean(tenantId),
      hasOrganizationId: Boolean(organizationId),
    })
    return
  }

  const container = resolveContainer(ctx)
  let em: EntityManager
  try {
    em = container.resolve<EntityManager>('em').fork()
  } catch (error) {
    logger.error('[internal] promotions:order-cancelled-usage-revert failed to initialize persistence', {
      err: error,
      orderId,
      tenantId,
      organizationId,
    })
    throw error
  }

  const scope: PromotionsCodeScope = { tenantId, organizationId }

  try {
    // `revertUsage` (budget/per-order ledger bookkeeping) runs first, matching the
    // order the C5 finding itself names ("`revertUsage` + `revertCodeUse`") — the two
    // touch disjoint tables (`PromotionUsage` vs `CodeUsage`/`Code`/`GeneratedCode`)
    // with no read-after-write dependency between them, so this ordering is a
    // documentation-matching choice, not a correctness requirement.
    const usageService = container.resolve<PromotionUsageService>('promotionUsageService')
    await usageService.revertUsage(em, { orderId }, scope)

    const codeService = container.resolve<PromotionCodeService>('promotionCodeService')
    await codeService.revertCodeUse(em, { orderId }, scope)
  } catch (error) {
    logger.error('[internal] promotions:order-cancelled-usage-revert failed', {
      err: error,
      orderId,
      tenantId,
      organizationId,
    })
    throw error
  }
}
