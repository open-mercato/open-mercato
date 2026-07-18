/**
 * Scrap-by-reason aggregation (task 6.1, spec § Scope). Pure/unit-testable
 * module fed by scoped `ProductionReport` rows — no ORM/em access here
 * (same convention as `lib/reports/lateOrders.ts` / `consumption.ts`).
 *
 * Reports with a `null` `scrapReasonEntryId` (the operator report form lets
 * `scrapReasonEntryId` be optional even when `qtyScrap > 0`) are bucketed
 * under the `UNSPECIFIED_SCRAP_REASON` sentinel rather than being dropped,
 * so scrap that was never assigned a reason is still visible in the total.
 */

export const UNSPECIFIED_SCRAP_REASON = 'unspecified' as const

export type ScrapReportRow = {
  scrapReasonEntryId: string | null
  qtyScrap: string
}

export type ScrapReasonAggregate = {
  /** The dictionary entry id, or `UNSPECIFIED_SCRAP_REASON` for the null bucket. */
  scrapReasonEntryId: string
  qtyScrap: number
  reportCount: number
}

export function aggregateScrapByReason(rows: ScrapReportRow[]): ScrapReasonAggregate[] {
  const buckets = new Map<string, { qtyScrap: number; reportCount: number }>()

  for (const row of rows) {
    const qty = Number(row.qtyScrap)
    if (qty <= 0) continue
    const key = row.scrapReasonEntryId ?? UNSPECIFIED_SCRAP_REASON
    const bucket = buckets.get(key) ?? { qtyScrap: 0, reportCount: 0 }
    bucket.qtyScrap += qty
    bucket.reportCount += 1
    buckets.set(key, bucket)
  }

  return Array.from(buckets.entries())
    .map(([scrapReasonEntryId, bucket]) => ({ scrapReasonEntryId, ...bucket }))
    .sort((a, b) => b.qtyScrap - a.qtyScrap)
}
