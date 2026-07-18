/**
 * Late/at-risk orders (task 6.1, spec § Scope: "MVP reports (quantity-based
 * only, no valuation): late/at-risk orders"). Kept pure/unit-testable on
 * purpose (no ORM/em access) — the API route loads the scoped
 * `ProductionOrder` rows and passes them here, matching the
 * `lib/operatorQueue.ts` / `lib/materialShortages.ts` convention of pure
 * computation modules fed by already-scoped DB rows.
 *
 * Classification rule (day-granularity, both `dueDate` and `now` are
 * truncated to their UTC calendar day before comparing, so a due date whose
 * timestamp lands earlier in the day than the current wall-clock time is
 * not misclassified as "late" purely from clock skew):
 *   - `late`: due date's calendar day is strictly BEFORE today's calendar
 *     day, AND remaining qty (`qtyPlanned - qtyCompleted`) > 0.
 *   - `at_risk`: due date's calendar day is today or within `atRiskDays`
 *     days from today (inclusive), AND remaining qty > 0, AND not `late`.
 *     A due date that falls exactly on today's calendar day is `at_risk`,
 *     never `late` (the order is not yet overdue — it is due today).
 *   - Orders with no `dueDate`, non-positive remaining qty, or a status
 *     outside `released`/`in_progress` are excluded entirely (defensive:
 *     the API route's query already filters by status, but the pure
 *     function re-asserts it so a caller passing raw rows can't
 *     accidentally surface a `completed`/`closed`/`cancelled` order).
 */

const ELIGIBLE_STATUSES = new Set(['released', 'in_progress'])

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type LateAtRiskOrderRow = {
  id: string
  number: number
  productId: string
  variantId: string | null
  qtyPlanned: string
  qtyCompleted: string
  dueDate: string | Date | null
  status: string
}

export type LateAtRiskClassification = 'late' | 'at_risk'

export type LateAtRiskOrderResult = {
  id: string
  number: number
  productId: string
  variantId: string | null
  qtyPlanned: number
  qtyCompleted: number
  remainingQty: number
  dueDate: string
  status: string
  classification: LateAtRiskClassification
  daysLate: number
  daysUntilDue: number
}

function toUtcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

export function classifyLateAtRiskOrders(
  orders: LateAtRiskOrderRow[],
  options: { now: Date; atRiskDays: number },
): LateAtRiskOrderResult[] {
  const nowDay = toUtcDayStart(options.now)
  const atRiskDays = Math.max(0, options.atRiskDays)

  const results: LateAtRiskOrderResult[] = []
  for (const order of orders) {
    if (!ELIGIBLE_STATUSES.has(order.status)) continue
    if (!order.dueDate) continue

    const remainingQty = Number(order.qtyPlanned) - Number(order.qtyCompleted)
    if (remainingQty <= 0) continue

    const dueDate = order.dueDate instanceof Date ? order.dueDate : new Date(order.dueDate)
    const dueDay = toUtcDayStart(dueDate)
    const daysDiff = Math.round((dueDay - nowDay) / MS_PER_DAY)

    if (daysDiff < 0) {
      results.push({
        id: order.id,
        number: order.number,
        productId: order.productId,
        variantId: order.variantId,
        qtyPlanned: Number(order.qtyPlanned),
        qtyCompleted: Number(order.qtyCompleted),
        remainingQty,
        dueDate: dueDate.toISOString(),
        status: order.status,
        classification: 'late',
        daysLate: -daysDiff,
        daysUntilDue: daysDiff,
      })
      continue
    }

    if (daysDiff <= atRiskDays) {
      results.push({
        id: order.id,
        number: order.number,
        productId: order.productId,
        variantId: order.variantId,
        qtyPlanned: Number(order.qtyPlanned),
        qtyCompleted: Number(order.qtyCompleted),
        remainingQty,
        dueDate: dueDate.toISOString(),
        status: order.status,
        classification: 'at_risk',
        daysLate: 0,
        daysUntilDue: daysDiff,
      })
    }
  }

  return results
}
