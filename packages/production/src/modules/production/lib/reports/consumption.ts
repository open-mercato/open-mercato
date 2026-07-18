/**
 * Actual vs. standard consumption (quantities only, task 6.1, spec §
 * Scope). Pure/unit-testable module fed by scoped `ProductionOrderMaterial`
 * (+ `ProductionOrderOperation`) rows — no ORM/em access here (same
 * convention as `lib/reports/lateOrders.ts`).
 *
 * Semantics of "standard" (review finding, task 6.1 R1 — corrects an
 * earlier version of this module): `ProductionOrderMaterial.qtyRequired` is
 * a snapshot of the BOM item's `qtyPerUnit` — i.e. material needed for ONE
 * finished unit (see `commands/orders.ts#releaseOrderCommand`, task 3.1).
 * `qtyIssued` (the "actual" side) is NOT directly comparable to that raw
 * per-unit value: `lib/backflush.ts#computeBackflushIssueLines` (the
 * authoritative producer of `qtyIssued`) accumulates
 * `qtyPerUnit * (1 + scrapFactor) * consumedUnits` on every report, where
 * `consumedUnits = reportedGoodQty + reportedScrapQty` for that report. So
 * to compare on the SAME basis, the standard side must be scaled the exact
 * same way: `standardQty = qtyPerUnit * (1 + scrapFactor) * consumedUnits`,
 * where `consumedUnits` is the CUMULATIVE good+scrap units already reported
 * against the operation this material backflushes on (see
 * `resolveConsumedUnitsForMaterial` below, which mirrors
 * `commands/reports.ts`'s `selectBackflushMaterials` operation-selection
 * convention exactly: a material pinned to an `operationSequence`
 * backflushes against THAT operation's cumulative qtyGood+qtyScrap; a
 * material with no `operationSequence` backflushes against the order's LAST
 * reporting-point operation instead).
 *
 * `standardQty === 0` (no units consumed yet against the relevant
 * operation) is guarded explicitly: `variancePct` is `null` in that case (a
 * percentage against a zero base is undefined) rather than `Infinity`/`NaN`.
 */

export type ConsumptionOperationLike = {
  sequence: number
  isReportingPoint: boolean
  qtyGood: string
  qtyScrap: string
}

/**
 * Resolves the cumulative good+scrap "consumed units" basis a given
 * material's standard quantity must be scaled by, mirroring
 * `commands/reports.ts`'s operation-selection convention: an
 * `operationSequence`-pinned material uses THAT operation's own cumulative
 * qtyGood+qtyScrap; an unpinned (`null`) material uses the order's LAST
 * reporting-point operation (by `sequence`) instead. Returns `0` when the
 * relevant operation can't be found (e.g. not yet reported against) — this
 * correctly yields `standardQty = 0` for a material nothing has been
 * consumed against yet, rather than a misleading order-level approximation
 * (order.qtyCompleted/qtyScrapped only update on TRUE order completion —
 * the LAST reporting operation's final report — so they under-count
 * consumption for orders still `in_progress`, or for materials pinned to an
 * earlier, non-last operation; see `commands/reports.ts` lines ~395-409).
 */
export function resolveConsumedUnitsForMaterial(
  operationSequence: number | null,
  operations: ConsumptionOperationLike[],
): number {
  if (operationSequence != null) {
    const operation = operations.find((op) => op.sequence === operationSequence)
    return operation ? Number(operation.qtyGood) + Number(operation.qtyScrap) : 0
  }

  const reportingOps = operations.filter((op) => op.isReportingPoint).sort((a, b) => a.sequence - b.sequence)
  const lastReportingOp = reportingOps[reportingOps.length - 1]
  return lastReportingOp ? Number(lastReportingOp.qtyGood) + Number(lastReportingOp.qtyScrap) : 0
}

export type ConsumptionMaterialRow = {
  orderId: string
  orderNumber: number
  componentProductId: string
  componentVariantId: string | null
  /** `ProductionOrderMaterial.qtyRequired` — material needed per ONE finished unit (see module doc). */
  qtyPerUnit: string
  scrapFactor: string
  qtyIssued: string
  /** Resolved via `resolveConsumedUnitsForMaterial` — see module doc for the basis. */
  consumedUnits: number
}

export type ConsumptionLine = {
  orderId: string
  orderNumber: number
  componentProductId: string
  componentVariantId: string | null
  standardQty: number
  actualQty: number
  varianceQty: number
  variancePct: number | null
}

export function computeConsumptionVariance(rows: ConsumptionMaterialRow[]): ConsumptionLine[] {
  return rows.map((row) => {
    const qtyPerUnit = Number(row.qtyPerUnit)
    const scrapFactor = Number(row.scrapFactor)
    const standardQty = qtyPerUnit * (1 + scrapFactor) * row.consumedUnits
    const actualQty = Number(row.qtyIssued)
    const varianceQty = actualQty - standardQty
    return {
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      componentProductId: row.componentProductId,
      componentVariantId: row.componentVariantId,
      standardQty,
      actualQty,
      varianceQty,
      variancePct: standardQty === 0 ? null : (varianceQty / standardQty) * 100,
    }
  })
}

export type ConsumptionProductAggregate = {
  componentProductId: string
  componentVariantId: string | null
  standardQty: number
  actualQty: number
  varianceQty: number
  variancePct: number | null
  orderCount: number
}

/**
 * Aggregates already-computed lines per component product (+ variant)
 * across every order in the selected date range. `orderCount` counts
 * distinct orders contributing to the bucket (a component can appear once
 * per order per `operationSequence`, so this is not simply `lines.length`).
 */
export function aggregateConsumptionByProduct(lines: ConsumptionLine[]): ConsumptionProductAggregate[] {
  const buckets = new Map<
    string,
    { componentProductId: string; componentVariantId: string | null; standardQty: number; actualQty: number; orderIds: Set<string> }
  >()

  for (const line of lines) {
    const key = `${line.componentProductId}::${line.componentVariantId ?? ''}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        componentProductId: line.componentProductId,
        componentVariantId: line.componentVariantId,
        standardQty: 0,
        actualQty: 0,
        orderIds: new Set(),
      }
      buckets.set(key, bucket)
    }
    bucket.standardQty += line.standardQty
    bucket.actualQty += line.actualQty
    bucket.orderIds.add(line.orderId)
  }

  return Array.from(buckets.values()).map((bucket) => {
    const varianceQty = bucket.actualQty - bucket.standardQty
    return {
      componentProductId: bucket.componentProductId,
      componentVariantId: bucket.componentVariantId,
      standardQty: bucket.standardQty,
      actualQty: bucket.actualQty,
      varianceQty,
      variancePct: bucket.standardQty === 0 ? null : (varianceQty / bucket.standardQty) * 100,
      orderCount: bucket.orderIds.size,
    }
  })
}
