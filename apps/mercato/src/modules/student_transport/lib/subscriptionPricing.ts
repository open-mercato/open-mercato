import { computeVatFromNet, roundToHalalas } from '../../saudi_localization/lib/saudi/vat'
import type { SubscriptionDirection } from '../data/entities'

/**
 * What a subscription costs for one billing period.
 *
 * The direction decides which plan price applies: a two-way rider pays the
 * round-trip price, a one-way rider the single-leg price. The price is resolved
 * once, when the subscription is created or its plan changes, and stored on the
 * subscription as `periodPrice` — so a later plan edit never silently re-prices
 * an existing contract, exactly like a snapshotted rate.
 */

export type PlanPriceInput = {
  priceTwoWay: string | number | null | undefined
  priceOneWay: string | number | null | undefined
}

export function resolvePeriodPrice(direction: SubscriptionDirection, plan: PlanPriceInput): string {
  const raw = direction === 'two_way' ? plan.priceTwoWay : plan.priceOneWay
  const parsed = typeof raw === 'number' ? raw : Number(raw ?? 0)
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 0
  return roundToHalalas(value).toFixed(2)
}

export type SubscriptionCharge = {
  net: string
  tax: string
  gross: string
}

export function computePeriodCharge(periodPrice: string | number | null | undefined, taxRatePercent: string | number | null | undefined): SubscriptionCharge {
  const net = typeof periodPrice === 'number' ? periodPrice : Number(periodPrice ?? 0)
  const rate = (typeof taxRatePercent === 'number' ? taxRatePercent : Number(taxRatePercent ?? 0)) / 100
  const breakdown = computeVatFromNet(Number.isFinite(net) ? net : 0, Number.isFinite(rate) ? rate : 0)
  return {
    net: roundToHalalas(breakdown.net).toFixed(2),
    tax: roundToHalalas(breakdown.vat).toFixed(2),
    gross: roundToHalalas(breakdown.gross).toFixed(2),
  }
}

/**
 * How many billing periods a window covers — used by the B2B reconciliation
 * view when a school's contract is invoiced for a term.
 */
export function periodsInWindow(
  duration: 'monthly' | 'quarterly' | 'annual' | 'custom_b2b_contract',
  startDate: string | Date | null | undefined,
  endDate: string | Date | null | undefined,
): number {
  if (!startDate || !endDate) return 1
  const start = new Date(startDate).getTime()
  const end = new Date(endDate).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1
  const days = Math.ceil((end - start) / 86_400_000)
  if (duration === 'quarterly') return Math.max(1, Math.ceil(days / 90))
  if (duration === 'annual') return Math.max(1, Math.ceil(days / 365))
  return Math.max(1, Math.ceil(days / 30))
}
