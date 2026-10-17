import { isUuid } from '@open-mercato/shared/lib/causation/types'
import type {
  ExplainFieldProvider,
  ExplainHistoryEntry,
  ExplainProviderContext,
  ExplainProviderFact,
  ExplainReferenceDetail,
} from '@open-mercato/shared/modules/insights/explain'
import type {
  ActionLogFieldHistoryPage,
  ActionLogFieldHistoryQuery,
  ActionLogHistoryCursor,
} from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import { compareScaledAmounts, formatScaledAmount, toScaledAmount } from './priceAmounts'

export const SALES_LINE_PRICE_PROVIDER_ID = 'sales.line_price'
export const CATALOG_PRICE_REFERENCE_KIND = 'catalog.price'
export const CATALOG_PRICE_LOG_RESOURCE_KIND = 'catalog.price'
export const PRICE_HISTORY_PAGE_SIZE = 100
export const PRICE_HISTORY_MAX_PAGES = 2
export const PRICE_HISTORY_ORDER_TOLERANCE_MS = 5

export const LINE_PRICE_OUTCOMES = ['matched_price_row', 'differs', 'no_catalog_link', 'unverifiable'] as const
export type LinePriceOutcome = (typeof LINE_PRICE_OUTCOMES)[number]

export const LINE_PRICE_UNVERIFIABLE_REASONS = [
  'price_unavailable',
  'currency_mismatch',
  'price_amount_missing',
  'price_absent_at_write',
] as const
export type LinePriceUnverifiableReason = (typeof LINE_PRICE_UNVERIFIABLE_REASONS)[number]

export type PriceBasis = 'net' | 'gross'

export const LINE_PRICE_FACT_KEYS = {
  noCatalogLink: 'sales.insights.linePrice.noCatalogLink',
  matchedPriceRow: {
    net: 'sales.insights.linePrice.matchedPriceRowNet',
    gross: 'sales.insights.linePrice.matchedPriceRowGross',
  } satisfies Record<PriceBasis, string>,
  matchedPriceRowCurrent: {
    net: 'sales.insights.linePrice.matchedPriceRowCurrentNet',
    gross: 'sales.insights.linePrice.matchedPriceRowCurrentGross',
  } satisfies Record<PriceBasis, string>,
  differs: {
    net: 'sales.insights.linePrice.differsNet',
    gross: 'sales.insights.linePrice.differsGross',
  } satisfies Record<PriceBasis, string>,
  differsCurrent: {
    net: 'sales.insights.linePrice.differsCurrentNet',
    gross: 'sales.insights.linePrice.differsCurrentGross',
  } satisfies Record<PriceBasis, string>,
  unverifiable: {
    price_unavailable: 'sales.insights.linePrice.unverifiable.priceUnavailable',
    currency_mismatch: 'sales.insights.linePrice.unverifiable.currencyMismatch',
    price_amount_missing: 'sales.insights.linePrice.unverifiable.priceAmountMissing',
    price_absent_at_write: 'sales.insights.linePrice.unverifiable.priceAbsentAtWrite',
  } satisfies Record<LinePriceUnverifiableReason, string>,
} as const

export type LinePriceState = {
  id: string
  priceId: string | null
  priceMode: PriceBasis | null
  currencyCode: string | null
  unitPriceNet: unknown
  unitPriceGross: unknown
}

type SnapshotLineState =
  | { present: false }
  | { present: true; amount: bigint | null; priceId: string | null }

type PriceRowState = {
  amount: bigint | null
  currencyCode: string | null
}

export type PriceAmountAsOf =
  | { status: 'found'; state: PriceRowState }
  | { status: 'absent' }
  | { status: 'unknown' }

type PriceHistoryReader = {
  findFieldHistory: (query: ActionLogFieldHistoryQuery) => Promise<ActionLogFieldHistoryPage>
}

type FactParams = NonNullable<ExplainProviderFact['params']>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeCurrency(value: unknown): string | null {
  const text = readText(value)
  return text ? text.toUpperCase() : null
}

export function readLinePriceMode(value: unknown): PriceBasis | null {
  return value === 'net' || value === 'gross' ? value : null
}

function readLinePriceId(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null
  return readText(metadata.priceId)
}

function readTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function amountKey(basis: PriceBasis): 'unitPriceNet' | 'unitPriceGross' {
  return basis === 'gross' ? 'unitPriceGross' : 'unitPriceNet'
}

export function readLinePriceState(current: Record<string, unknown>, itemId: string | null): LinePriceState | null {
  if (!itemId || !Array.isArray(current.lines)) return null
  for (const candidate of current.lines) {
    if (!isRecord(candidate)) continue
    const id = candidate.id
    if (id === null || id === undefined || String(id) !== itemId) continue
    return {
      id: itemId,
      priceId: readText(candidate.priceId),
      priceMode: readLinePriceMode(candidate.priceMode),
      currencyCode: normalizeCurrency(candidate.currencyCode),
      unitPriceNet: candidate.unitPriceNet,
      unitPriceGross: candidate.unitPriceGross,
    }
  }
  return null
}

/**
 * The amount a line's price was entered in: the line's recorded `priceMode`, or the
 * explained field's own amount when no mode was recorded.
 */
export function resolvePriceBasis(line: LinePriceState, fieldKey: string): PriceBasis {
  if (line.priceMode) return line.priceMode
  return fieldKey === 'unitPriceGross' ? 'gross' : 'net'
}

function readSnapshotLine(snapshot: unknown, itemId: string, basis: PriceBasis): SnapshotLineState | null {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.lines)) return null
  for (const candidate of snapshot.lines) {
    if (!isRecord(candidate)) continue
    const id = candidate.id
    if (id === null || id === undefined || String(id) !== itemId) continue
    return {
      present: true,
      amount: toScaledAmount(candidate[amountKey(basis)]),
      priceId: readLinePriceId(candidate.metadata),
    }
  }
  return { present: false }
}

function readHistoryAction(entry: ExplainHistoryEntry): string | null {
  return 'historyAction' in entry && typeof entry.historyAction === 'string' ? entry.historyAction : null
}

function isUndoTraceEntry(entry: ExplainHistoryEntry): boolean {
  return readHistoryAction(entry) === 'undo'
}

function isRedoEntry(entry: ExplainHistoryEntry): boolean {
  return readHistoryAction(entry) === 'redo' || entry.causeKind === 'redo'
}

function isEffectiveEntry(entry: ExplainHistoryEntry): boolean {
  if (entry.executionState === 'undone' || entry.executionState === 'failed') return false
  return !isUndoTraceEntry(entry)
}

function sameLineState(
  state: { amount: bigint | null; priceId: string | null },
  target: { amount: bigint; priceId: string | null },
): boolean {
  return state.amount !== null && state.amount === target.amount && state.priceId === target.priceId
}

/**
 * Finds when the line's current price (amount in `basis` plus price link) was written,
 * from the document's own history (newest first). Undone entries and undo traces are
 * skipped, so a value restored by an undo is attributed to the entry that first set it.
 * Returns null when the history cannot show it (not scanned, unrecorded change, an
 * entry without a readable line list, or a redo — which replays an earlier input, so its
 * time is not when the price was chosen).
 */
export function findLinePriceWriteTime(
  history: readonly ExplainHistoryEntry[],
  line: { id: string; priceId: string | null },
  basis: PriceBasis,
  currentAmount: bigint,
): string | null {
  const target = { amount: currentAmount, priceId: line.priceId }
  for (const entry of history) {
    if (!isEffectiveEntry(entry)) continue
    const after = readSnapshotLine(entry.snapshotAfter, line.id, basis)
    if (!after || !after.present) continue
    if (!sameLineState(after, target)) return null
    const before = entry.snapshotBefore === null || entry.snapshotBefore === undefined
      ? { present: false as const }
      : readSnapshotLine(entry.snapshotBefore, line.id, basis)
    if (!before) continue
    if (!before.present || !sameLineState(before, target)) return isRedoEntry(entry) ? null : entry.at
  }
  return null
}

function readPriceRowState(snapshot: unknown, basis: PriceBasis): PriceRowState | null {
  if (!isRecord(snapshot)) return null
  return {
    amount: toScaledAmount(snapshot[amountKey(basis)]),
    currencyCode: normalizeCurrency(snapshot.currencyCode),
  }
}

function resolveHistoryReader(ctx: ExplainProviderContext): PriceHistoryReader | null {
  const candidate = ctx.resolve<PriceHistoryReader>('actionLogService')
  if (!candidate || typeof candidate.findFieldHistory !== 'function') return null
  return candidate
}

function stateFromEntryAfter(entry: ExplainHistoryEntry, basis: PriceBasis): PriceAmountAsOf {
  if (entry.snapshotAfter === null || entry.snapshotAfter === undefined) {
    return entry.actionType === 'delete' || isUndoTraceEntry(entry) ? { status: 'absent' } : { status: 'unknown' }
  }
  const state = readPriceRowState(entry.snapshotAfter, basis)
  return state ? { status: 'found', state } : { status: 'unknown' }
}

function stateBeforeOldestEntry(entry: ExplainHistoryEntry, basis: PriceBasis): PriceAmountAsOf {
  if (entry.snapshotBefore === null || entry.snapshotBefore === undefined) {
    return entry.actionType === 'create' ? { status: 'absent' } : { status: 'unknown' }
  }
  const state = readPriceRowState(entry.snapshotBefore, basis)
  return state ? { status: 'found', state } : { status: 'unknown' }
}

/**
 * Reads the price row's state at `writtenAt` from its own audit history: the newest
 * entry at or before that time, or — when the whole history is newer and fully read —
 * the state before its oldest entry. `unknown` when the history cannot show it,
 * including a price change within `PRICE_HISTORY_ORDER_TOLERANCE_MS` of the write, whose
 * order relative to it is uncertain.
 */
export async function readPriceAmountAsOf(
  ctx: ExplainProviderContext,
  priceId: string,
  writtenAt: string,
  basis: PriceBasis,
): Promise<PriceAmountAsOf> {
  const writtenAtMs = readTimestamp(writtenAt)
  const reader = resolveHistoryReader(ctx)
  if (writtenAtMs === null || !reader) return { status: 'unknown' }
  let cursor: ActionLogHistoryCursor | null = null
  let oldest: ExplainHistoryEntry | null = null
  for (let page = 0; page < PRICE_HISTORY_MAX_PAGES; page += 1) {
    const result: ActionLogFieldHistoryPage = await reader.findFieldHistory({
      tenantId: ctx.scope.tenantId,
      organizationIds: ctx.scope.organizationIds,
      resourceKinds: [CATALOG_PRICE_LOG_RESOURCE_KIND],
      resourceId: priceId,
      before: cursor,
      limit: PRICE_HISTORY_PAGE_SIZE,
    })
    for (const entry of result.entries) {
      if (entry.executionState === 'failed') continue
      const at = readTimestamp(entry.at)
      if (at === null || Math.abs(at - writtenAtMs) <= PRICE_HISTORY_ORDER_TOLERANCE_MS) return { status: 'unknown' }
      if (at < writtenAtMs) return stateFromEntryAfter(entry, basis)
      oldest = entry
    }
    if (!result.nextBefore) {
      return oldest ? stateBeforeOldestEntry(oldest, basis) : { status: 'unknown' }
    }
    cursor = result.nextBefore
  }
  return { status: 'unknown' }
}

function unverifiable(
  reason: LinePriceUnverifiableReason,
  params: FactParams,
  reference: ExplainProviderFact['reference'] = null,
): ExplainProviderFact {
  return {
    key: LINE_PRICE_FACT_KEYS.unverifiable[reason],
    params: { outcome: 'unverifiable', reason, ...params },
    confidence: 'unknown',
    reference,
  }
}

function readDetailFact(detail: ExplainReferenceDetail, key: string): unknown {
  return detail.facts ? detail.facts[key] : undefined
}

function readCurrentPriceRowState(detail: ExplainReferenceDetail, basis: PriceBasis): PriceRowState {
  return {
    amount: toScaledAmount(readDetailFact(detail, amountKey(basis))),
    currencyCode: normalizeCurrency(readDetailFact(detail, 'currencyCode')),
  }
}

function lineAmountFor(line: LinePriceState, basis: PriceBasis): bigint | null {
  return toScaledAmount(basis === 'gross' ? line.unitPriceGross : line.unitPriceNet)
}

/**
 * Explains a sales line unit price against the catalog price row recorded on the line
 * (`metadata.priceId`). It reports equality or difference with that row's amount — as
 * of the line's write time when the price row's history shows it — and never claims
 * the catalog selected the price: selection is not recorded, so a comparison is at most
 * `inferred`. A missing, foreign or unreadable price row, a currency mismatch or a
 * missing amount is `unverifiable`.
 */
export async function explainLinePrice(ctx: ExplainProviderContext): Promise<ExplainProviderFact[]> {
  const line = readLinePriceState(ctx.current, ctx.itemId)
  if (!line) return []
  if (!line.priceId) {
    return [{ key: LINE_PRICE_FACT_KEYS.noCatalogLink, params: { outcome: 'no_catalog_link' }, confidence: 'proven', reference: null }]
  }
  const basis = resolvePriceBasis(line, ctx.field.key)
  const lineAmount = lineAmountFor(line, basis)
  if (lineAmount === null) return []
  if (!isUuid(line.priceId)) return [unverifiable('price_unavailable', { basis })]
  const priceId = line.priceId.toLowerCase()
  const [detail] = (await ctx.resolveReference(CATALOG_PRICE_REFERENCE_KIND, [priceId]))
    .filter((candidate) => candidate.kind === CATALOG_PRICE_REFERENCE_KIND && candidate.id.toLowerCase() === priceId)
  if (!detail) return [unverifiable('price_unavailable', { basis })]
  const reference = { kind: CATALOG_PRICE_REFERENCE_KIND, id: detail.id }
  const currentRow = readCurrentPriceRowState(detail, basis)

  let comparedRow: PriceRowState = currentRow
  let comparedAt: string | null = null
  const writtenAt = findLinePriceWriteTime(ctx.history, { id: line.id, priceId: line.priceId }, basis, lineAmount)
  if (writtenAt) {
    const historical = await readPriceAmountAsOf(ctx, detail.id, writtenAt, basis)
    if (historical.status === 'absent') return [unverifiable('price_absent_at_write', { basis, at: writtenAt }, reference)]
    if (historical.status === 'found') {
      comparedRow = historical.state
      comparedAt = writtenAt
    }
  }

  const priceCurrency = comparedRow.currencyCode ?? currentRow.currencyCode
  if (!line.currencyCode || !priceCurrency || line.currencyCode !== priceCurrency) {
    return [unverifiable('currency_mismatch', { basis, lineCurrency: line.currencyCode, priceCurrency }, reference)]
  }
  if (comparedRow.amount === null) {
    return [unverifiable('price_amount_missing', { basis, at: comparedAt }, reference)]
  }

  const matched = compareScaledAmounts(lineAmount, comparedRow.amount) === 0
  const fromHistory = comparedAt !== null
  const params: FactParams = {
    outcome: matched ? 'matched_price_row' : 'differs',
    basis,
    lineAmount: formatScaledAmount(lineAmount),
    priceAmount: formatScaledAmount(comparedRow.amount),
    currencyCode: line.currencyCode,
    amountSource: fromHistory ? 'history' : 'current',
    at: comparedAt,
    priceChangedSince: fromHistory && currentRow.amount !== null ? currentRow.amount !== comparedRow.amount : null,
  }
  const keys = matched
    ? fromHistory ? LINE_PRICE_FACT_KEYS.matchedPriceRow : LINE_PRICE_FACT_KEYS.matchedPriceRowCurrent
    : fromHistory ? LINE_PRICE_FACT_KEYS.differs : LINE_PRICE_FACT_KEYS.differsCurrent
  return [{ key: keys[basis], params, confidence: 'inferred', reference }]
}

export const linePriceProvider: ExplainFieldProvider = {
  id: SALES_LINE_PRICE_PROVIDER_ID,
  explain: explainLinePrice,
}
