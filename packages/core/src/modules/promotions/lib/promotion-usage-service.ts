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

async function emitBudgetExhaustedEvent(
  promotionId: string,
  orderId: string,
  scope: PromotionsUsageScope,
  // #8268 review Major 8: `register` means checkout's first `registerUsage` call refused
  // the budget — the caller (`submit.ts`) compensates/cancels the order synchronously, so
  // there is nothing left for staff to reconcile. `reinstate` means `reinstateUsage`
  // refused to revive a PREVIOUSLY-reverted usage row on order confirmation — the order
  // keeps its original discount with no usage counted anywhere, which IS the actionable gap
  // `promotions.usage.reinstate_blocked` exists for. The notification subscriber uses this
  // to notify only on the actionable case.
  origin: 'register' | 'reinstate',
): Promise<void> {
  try {
    await emitPromotionsEvent(
      'promotions.promotion.budget_exhausted',
      { promotionId, orderId, tenantId: scope.tenantId, organizationId: scope.organizationId, origin },
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
      await emitBudgetExhaustedEvent(applied.promotionId, input.orderId, scope, 'register')
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

  /**
   * Release 5 review fix (#8268 Major 3 / #8817): the inverse of `revertUsage` — restores
   * every `PromotionUsage` row this order's cancellation reverted by clearing
   * `revertedAt`, same shape as `customer_groups`'s own
   * `order-confirmed-credit-reinstate.ts`. Never re-runs the budget check `registerUsage`
   * performs at first use: a row that already exists proved the budget was available at
   * the time of the original use, and a cancel/undo cycle must not let budget consumed by
   * OTHER orders in between retroactively block reinstating this one's own prior grant.
   *
   * #8268 review Medium 9 (#8940 item 2) narrows that one step further: "not re-running the
   * budget check" must not mean "no budget check at all". Between this row's own revert and
   * this reinstate, OTHER orders can have consumed budget up to (or past) the cap — reviving
   * this row unconditionally would then push the promotion's live consumption past
   * `maxBudget`. That is the same hard numeric invariant `code-service.ts#reinstateCodeUse`
   * now enforces for a capped code, so each row gets the SAME row-locked re-read
   * `registerUsage` uses before deciding whether reinstating IT specifically would exceed
   * the budget — refusing that one row (leaving it reverted) rather than overflowing it.
   *
   * Idempotent: only rows that still carry a `revertedAt` are touched, so a redelivered
   * event finds nothing left to reinstate on a second pass — same no-op-on-redelivery
   * precedent as `revertUsage` above.
   */
  async reinstateUsage(
    em: EntityManager,
    input: RevertUsageInput,
    scope: PromotionsUsageScope,
  ): Promise<{ ok: true; reinstatedCount: number }> {
    const rows = await em.find(PromotionUsage, {
      orderId: input.orderId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      revertedAt: { $ne: null },
    })
    if (rows.length === 0) return { ok: true, reinstatedCount: 0 }

    const reinstatedRows: PromotionUsage[] = []
    for (const row of rows) {
      let blocked = false
      await withAtomicFlush(
        em,
        [
          async () => {
            const promotion = await em.findOne(
              Promotion,
              { id: row.promotionId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
              { lockMode: LockMode.PESSIMISTIC_WRITE },
            )
            // Same documented judgment calls `registerUsageForPromotion` makes: no parent
            // row, no configured budget, or a currency this module cannot compare against
            // the budget's own currency all skip enforcement rather than block the revival.
            if (!promotion || promotion.maxBudget == null || !promotion.budgetCurrency) return
            if (row.currency !== promotion.budgetCurrency) return
            const consumed = await this.getBudgetConsumed(em, row.promotionId, scope.organizationId, scope.tenantId, promotion.budgetCurrency)
            const projected = addDecimalStrings(consumed, row.totalDiscountAmount)
            if (exceedsLimit(projected, promotion.maxBudget)) blocked = true
          },
          () => {
            if (blocked) return
            row.revertedAt = null
          },
        ],
        { transaction: true, label: 'promotions.usage.reinstate' },
      )
      if (blocked) {
        usageLogger.warn('[internal] reinstateUsage refused — promotion is already at its budget cap', {
          orderId: input.orderId,
          promotionId: row.promotionId,
        })
        await emitBudgetExhaustedEvent(row.promotionId, input.orderId, scope, 'reinstate')
      } else {
        reinstatedRows.push(row)
      }
    }
    if (reinstatedRows.length === 0) return { ok: true, reinstatedCount: 0 }

    const distinctPromotionIds = Array.from(new Set(reinstatedRows.map((row) => row.promotionId)))
    for (const promotionId of distinctPromotionIds) {
      await emitRegisteredEvent(promotionId, input.orderId, scope)
    }

    return { ok: true, reinstatedCount: reinstatedRows.length }
  }
}
