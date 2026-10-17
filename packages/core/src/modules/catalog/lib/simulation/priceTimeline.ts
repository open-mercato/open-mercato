import type {
  SimulationRecordHistoryCursor,
  SimulationRecordHistoryEntry,
  SimulationRecordHistoryPage,
  SimulationRecordHistoryQuery,
} from '@open-mercato/shared/modules/insights/simulate'

/**
 * The amount timeline of one price row, read from the row's own audit history (resource kind
 * `catalog.price`, written by the price commands) for the price backtest. Entries keep only what
 * decides the row's amounts at a point in time — when, the action, the execution state, whether it
 * is an undo trace, and the amounts and currency of the before/after snapshots — newest first, at
 * most `PRICE_TIMELINE_PAGE_SIZE × PRICE_TIMELINE_MAX_PAGES` entries (the bound of the "Why?" line
 * price explanation). A longer history is `truncated`: amounts before its oldest kept entry are
 * unknown.
 */

export const CATALOG_PRICE_LOG_RESOURCE_KIND = 'catalog.price'

export const PRICE_TIMELINE_PAGE_SIZE = 100

export const PRICE_TIMELINE_MAX_PAGES = 2

export type CatalogPriceAmountSnapshot = {
  unitPriceNet: string | number | null
  unitPriceGross: string | number | null
  currencyCode: string | null
}

/** A snapshot that is not a record (e.g. still sealed) is kept as `unreadable`: its amounts are unknown. */
export type CatalogPriceTimelineSnapshot = CatalogPriceAmountSnapshot | null | 'unreadable'

export type CatalogPriceTimelineEntry = {
  at: string
  actionType: string | null
  executionState: string | null
  historyAction: string | null
  snapshotBefore: CatalogPriceTimelineSnapshot
  snapshotAfter: CatalogPriceTimelineSnapshot
}

/** `exhausted`: the whole history was read; `truncated`: it is longer than the bound. */
export type CatalogPriceTimeline = {
  entries: CatalogPriceTimelineEntry[]
  exhausted: boolean
  truncated: boolean
}

export type CatalogPriceHistoryReader = (query: SimulationRecordHistoryQuery) => Promise<SimulationRecordHistoryPage>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readAmount(value: unknown): string | number | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

export function toPriceTimelineSnapshot(snapshot: unknown): CatalogPriceTimelineSnapshot {
  if (snapshot === null || snapshot === undefined) return null
  if (!isRecord(snapshot)) return 'unreadable'
  return {
    unitPriceNet: readAmount(snapshot.unitPriceNet),
    unitPriceGross: readAmount(snapshot.unitPriceGross),
    currencyCode: typeof snapshot.currencyCode === 'string' ? snapshot.currencyCode : null,
  }
}

export function toPriceTimelineEntry(entry: SimulationRecordHistoryEntry): CatalogPriceTimelineEntry {
  return {
    at: entry.at,
    actionType: entry.actionType ?? null,
    executionState: entry.executionState ?? null,
    historyAction: entry.historyAction ?? null,
    snapshotBefore: toPriceTimelineSnapshot(entry.snapshotBefore),
    snapshotAfter: toPriceTimelineSnapshot(entry.snapshotAfter),
  }
}

/**
 * Reads the row's history newest first, page by page, up to the bound. Without a history reader
 * (an orchestrator that provides none) the timeline is empty and not exhausted, so every amount
 * at a point in time is unknown.
 */
export async function readCatalogPriceTimeline(read: CatalogPriceHistoryReader | undefined, priceId: string): Promise<CatalogPriceTimeline> {
  if (!read) return { entries: [], exhausted: false, truncated: false }
  const entries: CatalogPriceTimelineEntry[] = []
  let before: SimulationRecordHistoryCursor | null = null
  for (let page = 0; page < PRICE_TIMELINE_MAX_PAGES; page += 1) {
    const result: SimulationRecordHistoryPage = await read({
      resourceKinds: [CATALOG_PRICE_LOG_RESOURCE_KIND],
      resourceId: priceId,
      before,
      limit: PRICE_TIMELINE_PAGE_SIZE,
    })
    for (const entry of result.entries) entries.push(toPriceTimelineEntry(entry))
    if (!result.nextBefore) return { entries, exhausted: true, truncated: false }
    before = result.nextBefore
  }
  return { entries, exhausted: false, truncated: true }
}
