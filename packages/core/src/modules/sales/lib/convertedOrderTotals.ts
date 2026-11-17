import { rebuildDocumentResult } from './calculations'
import type { SalesAdjustmentDraft } from './types'

export type ConvertedOrderFeeTotals = {
  shippingNetAmount: string
  shippingGrossAmount: string
  surchargeTotalAmount: string
}

type ConvertedOrderFeeAdjustment = {
  scope?: string | null
  kind: string
  amountNet?: unknown
  amountGross?: unknown
  position?: number | null
}

const FEE_KINDS = new Set(['shipping', 'surcharge'])

function parseStoredAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readSnapshotAmount(totalsSnapshot: unknown, key: keyof ConvertedOrderFeeTotals): number | null {
  if (!totalsSnapshot || typeof totalsSnapshot !== 'object' || Array.isArray(totalsSnapshot)) return null
  const value = (totalsSnapshot as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isOrderScopedFee(adjustment: ConvertedOrderFeeAdjustment): boolean {
  return FEE_KINDS.has(adjustment.kind) && (!adjustment.scope || adjustment.scope === 'order')
}

function toFeeDraft(adjustment: ConvertedOrderFeeAdjustment): SalesAdjustmentDraft {
  return {
    scope: 'order',
    kind: adjustment.kind,
    amountNet: parseStoredAmount(adjustment.amountNet),
    amountGross: parseStoredAmount(adjustment.amountGross),
    position: adjustment.position ?? 0,
  }
}

/**
 * A quote has no shipping / surcharge columns: those buckets live only in its
 * `totalsSnapshot`, written by the same calculation as the grand total the
 * conversion copies. The order does have the columns, so read them from the
 * snapshot, and fall back to the engine's own bucketing of the copied
 * adjustment rows when the snapshot carries no number for them.
 */
export function resolveConvertedOrderFeeTotals(params: {
  totalsSnapshot: unknown
  currencyCode: string
  adjustments: ReadonlyArray<ConvertedOrderFeeAdjustment>
}): ConvertedOrderFeeTotals {
  const derived = rebuildDocumentResult({
    documentKind: 'order',
    currencyCode: params.currencyCode,
    lines: [],
    adjustments: params.adjustments.filter(isOrderScopedFee).map(toFeeDraft),
  }).totals
  const snapshotShippingNet = readSnapshotAmount(params.totalsSnapshot, 'shippingNetAmount')
  const snapshotShippingGross = readSnapshotAmount(params.totalsSnapshot, 'shippingGrossAmount')
  const snapshotSurcharge = readSnapshotAmount(params.totalsSnapshot, 'surchargeTotalAmount')
  const shippingFromSnapshot = snapshotShippingNet !== null && snapshotShippingGross !== null
  const shippingNet = shippingFromSnapshot ? snapshotShippingNet : derived.shippingNetAmount ?? 0
  const shippingGross = shippingFromSnapshot ? snapshotShippingGross : derived.shippingGrossAmount ?? 0
  const surcharge = snapshotSurcharge ?? derived.surchargeTotalAmount ?? 0
  return {
    shippingNetAmount: shippingNet.toString(),
    shippingGrossAmount: shippingGross.toString(),
    surchargeTotalAmount: surcharge.toString(),
  }
}
