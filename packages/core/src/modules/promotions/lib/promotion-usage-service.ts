import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Promotion, PromotionUsage } from '../data/entities'
import { emitPromotionsEvent } from '../events'
import type { AppliedPromotion, RegisterUsageInput, ResolvedEffect, RevertUsageInput } from './types'

// SPEC-055 §Promotion Usage Lifecycle / §A.2a (Release 4 PLAN.md Step 6.3). This file is
// `promotions`' own `lib/promotion-usage-service.ts` named by the spec's own method table
// (`promotionUsageService` DI token, §Release 4 Contract Freeze) — `commands/usage.ts`'s
// two registered commands (`promotions.usage.register`/`.usage.revert`) wrap it, same
// split as `commands/codes.ts` around `lib/code-service.ts` (Step 6.2).
//
// Row-lock correction (rev — C6/D-R4-12, replacing the serializable-isolation claim):
// `withAtomicFlush` joins an ambient transaction and ignores `isolationLevel`, and
// `checkout` is expected to call `registerUsage` inside its own order transaction. The row
// lock on the `Promotion` row — not a transaction isolation level — is what makes the
// budget re-read-then-write correct whether the call is top-level or nested, and needs no
// `40001` retry loop. Same precedent as `lib/code-service.ts`'s `useCode` locking `Code`/
// `GeneratedCode`.

export type PromotionsUsageScope = { tenantId: string; organizationId: string }

const usageLogger = createLogger('promotions').child({ component: 'usage' })

// ---------------------------------------------------------------------------
// Decimal-as-string money math. `total_discount_amount`/`max_budget` are
// `numeric(16,2)` columns (§Data Models) — always 2 fraction digits — so minor-units
// (cent) integer math avoids float reconversion error without pulling in a decimal
// library, same spirit as `lib/effect-resolvers.ts`'s `roundHalfUpToMinorUnits` (this
// module's own established convention for decimal-string arithmetic).
// ---------------------------------------------------------------------------

const MONEY_FRACTION_DIGITS = 2
const MONEY_MINOR_UNIT_FACTOR = 10 ** MONEY_FRACTION_DIGITS

function toMinorUnits(value: string): number {
  return Math.round(Number(value) * MONEY_MINOR_UNIT_FACTOR)
}

function formatMinorUnits(value: number): string {
  return (value / MONEY_MINOR_UNIT_FACTOR).toFixed(MONEY_FRACTION_DIGITS)
}

function addDecimalStrings(a: string, b: string): string {
  return formatMinorUnits(toMinorUnits(a) + toMinorUnits(b))
}

function exceedsLimit(total: string, limit: string): boolean {
  return toMinorUnits(total) > toMinorUnits(limit)
}

// §Data Models rev — budget-accounting rule: "Sum of |amountNet| across every
// ResolvedEffect for this promotion on this order that carries an amount. ADD_FREE_ITEM
// effects carry no amount and never contribute to this sum." Every other Release-4
// effect variant (`LINE_DISCOUNT`/`CART_DISCOUNT`/`DELIVERY_DISCOUNT`) carries `amountNet`.
function computeTotalDiscountAmount(effects: ResolvedEffect[]): string {
  let totalMinorUnits = 0
  for (const effect of effects) {
    if (effect.type === 'ADD_FREE_ITEM') continue
    totalMinorUnits += Math.abs(toMinorUnits(effect.amountNet))
  }
  return formatMinorUnits(totalMinorUnits)
}

async function emitRegisteredEvent(promotionId: string, orderId: string, scope: PromotionsUsageScope): Promise<void> {
  try {
    await emitPromotionsEvent(
      'promotions.usage.registered',
      { promotionId, orderId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { persistent: true },
    )
  } catch (err) {
    usageLogger.warn('[internal] promotions.usage.registered emit failed', { promotionId, orderId, err })
  }
}

async function emitBudgetExhaustedEvent(promotionId: string, orderId: string, scope: PromotionsUsageScope): Promise<void> {
  try {
    await emitPromotionsEvent(
      'promotions.promotion.budget_exhausted',
      { promotionId, orderId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { persistent: true },
    )
  } catch (err) {
    usageLogger.warn('[internal] promotions.promotion.budget_exhausted emit failed', { promotionId, orderId, err })
  }
}

async function emitRevertedEvent(promotionId: string, orderId: string, scope: PromotionsUsageScope): Promise<void> {
  try {
    await emitPromotionsEvent(
      'promotions.usage.reverted',
      { promotionId, orderId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { persistent: true },
    )
  } catch (err) {
    usageLogger.warn('[internal] promotions.usage.reverted emit failed', { promotionId, orderId, err })
  }
}

export class PromotionUsageService {
  /**
   * §Promotion Usage Lifecycle `getBudgetConsumed(promotionId, organizationId, tenantId,
   * currency)`: `SUM(total_discount_amount) WHERE reverted_at IS NULL AND currency = ?`.
   * Deliberately `em.find` + in-process sum rather than `services/promotion-cache.ts`'s
   * raw-SQL `sumPromotionUsage` — that one backs the CACHED, intentionally-stale
   * optimistic pre-check (`totalDiscountGranted`); this one is the AUTHORITATIVE re-read
   * `registerUsage` runs under the promotion row lock and must never go through the
   * cache. Exposed as its own public method per the spec's own method table — any
   * in-process caller may use it directly, not only `registerUsage`.
   */
  async getBudgetConsumed(
    em: EntityManager,
    promotionId: string,
    organizationId: string,
    tenantId: string,
    currency: string,
  ): Promise<string> {
    const rows = await em.find(PromotionUsage, {
      promotionId,
      organizationId,
      tenantId,
      currency,
      revertedAt: null,
    })
    let totalMinorUnits = 0
    for (const row of rows) totalMinorUnits += toMinorUnits(row.totalDiscountAmount)
    return formatMinorUnits(totalMinorUnits)
  }

  /**
   * Processes the WHOLE `input.appliedPromotions` array, one promotion at a time — each
   * with its own row lock, its own budget re-read, its own `PromotionUsage` write.
   * Never throws for a budget block: the "207 Multi-Status, partial success" semantic
   * PLAN.md's Step 6.3 names is a future HTTP route's job (Step 6.7) to translate; at this
   * DI-service layer a budget block is reported back in `budgetExceeded`, nothing more.
   */
  async registerUsage(
    em: EntityManager,
    input: RegisterUsageInput,
    scope: PromotionsUsageScope,
  ): Promise<{ ok: true; budgetExceeded: string[] }> {
    const budgetExceeded: string[] = []
    for (const applied of input.appliedPromotions) {
      const exceeded = await this.registerUsageForPromotion(em, input, applied, scope)
      if (exceeded) budgetExceeded.push(applied.promotionId)
    }
    return { ok: true, budgetExceeded }
  }

  private async registerUsageForPromotion(
    em: EntityManager,
    input: RegisterUsageInput,
    applied: AppliedPromotion,
    scope: PromotionsUsageScope,
  ): Promise<boolean> {
    // Idempotent upsert, keyed (promotion_id, order_id, tenant_id) per §Promotion Usage
    // Lifecycle — the unique constraint has no `reverted_at` component (§Data Models: a
    // ledger row must outlive the promotion it audited and is never re-created), so a
    // prior row — reverted or not — means this exact pair is already done.
    const existing = await em.findOne(PromotionUsage, {
      promotionId: applied.promotionId,
      orderId: input.orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
    if (existing) return false

    const totalDiscountAmount = computeTotalDiscountAmount(applied.effects)
    let blocked = false

    try {
      await withAtomicFlush(
        em,
        [
          async () => {
            // Lock the promotion row inside the (possibly ambient) transaction — this,
            // not an isolation level, is what makes the re-read-then-write correct under
            // real concurrency (§Promotion Usage Lifecycle's row-lock correction).
            const promotion = await em.findOne(
              Promotion,
              { id: applied.promotionId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
              { lockMode: LockMode.PESSIMISTIC_WRITE },
            )
            // No matching promotion row (e.g. deleted between `evaluate()` and
            // `registerUsage`): nothing to lock or enforce a budget against. The caller
            // already resolved the discount via `evaluate()` — write the ledger row
            // anyway rather than lose the compliance record over a since-deleted parent.
            if (!promotion) return
            if (promotion.maxBudget == null || !promotion.budgetCurrency) return
            // The sum re-read is only ever comparable in the promotion's own
            // `budgetCurrency` (§Promotion Usage Lifecycle: "re-read SUM(...) WHERE ...
            // currency = budget_currency"). When the order's currency differs, there is
            // no FX conversion in this module to make the two comparable — documented
            // judgment call: skip budget enforcement for this registration rather than
            // either wrongly blocking or wrongly summing across currencies.
            if (input.currency !== promotion.budgetCurrency) return
            const consumed = await this.getBudgetConsumed(em, applied.promotionId, scope.organizationId, scope.tenantId, promotion.budgetCurrency)
            const projected = addDecimalStrings(consumed, totalDiscountAmount)
            if (exceedsLimit(projected, promotion.maxBudget)) blocked = true
          },
          () => {
            if (blocked) return
            const usage = em.create(PromotionUsage, {
              organizationId: scope.organizationId,
              tenantId: scope.tenantId,
              promotionId: applied.promotionId,
              orderId: input.orderId,
              orderType: input.orderType,
              customerId: input.customerId,
              currency: input.currency,
              totalDiscountAmount,
              effectsSnapshot: applied.effects,
            })
            em.persist(usage)
          },
        ],
        { transaction: true, label: 'promotions.usage.register' },
      )
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      // Raced with another concurrent `registerUsage` for the exact same (promotion,
      // order) pair — the unique constraint caught it. Same idempotent-no-op treatment as
      // the pre-check above, not an error surfaced to the caller.
      return false
    }

    if (blocked) {
      await emitBudgetExhaustedEvent(applied.promotionId, input.orderId, scope)
      return true
    }

    await emitRegisteredEvent(applied.promotionId, input.orderId, scope)
    return false
  }

  /**
   * Sets `reverted_at` on every matching `PromotionUsage` row for this order — never
   * deletes rows (audit immutability, §Data Models). Emits one `promotions.usage.reverted`
   * per DISTINCT promotion affected, not once for the whole order and not once per row —
   * the cache-invalidation subscriber (`handlePromotionUsageCounterCacheInvalidation`)
   * evicts one promotion's counter per call, so an order that used N promotions needs N
   * invalidations, while two rows for the SAME promotion (defensive — the unique
   * constraint should prevent this) would only need one.
   */
  async revertUsage(
    em: EntityManager,
    input: RevertUsageInput,
    scope: PromotionsUsageScope,
  ): Promise<{ ok: true; revertedCount: number }> {
    const rows = await em.find(PromotionUsage, {
      orderId: input.orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      revertedAt: null,
    })
    if (rows.length === 0) return { ok: true, revertedCount: 0 }

    const now = new Date()
    await withAtomicFlush(
      em,
      [
        () => {
          for (const row of rows) row.revertedAt = now
        },
      ],
      { transaction: true, label: 'promotions.usage.revert' },
    )

    const distinctPromotionIds = Array.from(new Set(rows.map((row) => row.promotionId)))
    for (const promotionId of distinctPromotionIds) {
      await emitRevertedEvent(promotionId, input.orderId, scope)
    }

    return { ok: true, revertedCount: rows.length }
  }
}
