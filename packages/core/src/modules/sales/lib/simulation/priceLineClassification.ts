import {
  PRICE_HISTORY_ORDER_TOLERANCE_MS,
  finishPriceAmountHistoryScan,
  normalizeCurrency,
  readLinePriceMode,
  scanPriceAmountHistoryPage,
  startPriceAmountHistoryScan,
  stateBeforeOldestEntry,
  stateFromEntryAfter,
  type PriceAmountAsOf,
  type PriceBasis,
  type PriceHistoryEntry,
} from '../explain/linePriceProvider'
import { compareScaledAmounts, toScaledAmount } from '../explain/priceAmounts'

/**
 * Classification of a sales line that references a catalog price row (`metadata.priceId`) for the
 * price backtest (spec `2026-10-08-insights-change-simulator.md` S9), without per-document
 * history: the line's stored unit price (in the amount it was entered in, `metadata.priceMode`)
 * is compared with the row's amount at the line's `created_at`, read from the row's own timeline
 * through the "Why?" line price helpers (`readPriceAmountAsOf` semantics: a row change within
 * `PRICE_HISTORY_ORDER_TOLERANCE_MS` of the write is of uncertain order → unknown). Equal ⇒ the
 * line was priced from the row; different from every amount the row ever had up to the line's
 * last edit ⇒ a manual override; anything the timeline cannot show — including a price equal to
 * an EARLIER amount of the row (a line converted from a quote is dated at the conversion, a line
 * dialog may still show a price the row has since left) — ⇒ `cannot_tell` with a reason.
 */

export const PRICE_LINE_UNVERIFIABLE_REASONS = [
  'price_mode_unknown',
  'unit_conversion',
  'line_amount_missing',
  'price_change_within_tolerance',
  'price_history_truncated',
  'price_amount_unknown',
  'price_absent_at_write',
  'currency_mismatch',
  'price_amount_missing',
  'row_changed_while_line_edited',
  'matches_earlier_row_amount',
  'currency_differs_from_proposal',
  'basis_not_proposed',
] as const

export type PriceLineUnverifiableReason = (typeof PRICE_LINE_UNVERIFIABLE_REASONS)[number]

export type PriceLineOutcomeKind = 'priced_from_row' | 'manual_override' | 'cannot_tell'

/** A stored line as the scan reads it (amounts and quantity as numeric text). */
export type PriceLineRecord = {
  createdAt: string
  updatedAt: string | null
  currencyCode: string | null
  quantity: unknown
  unitPriceNet: unknown
  unitPriceGross: unknown
  priceMode: unknown
  uomFactor: unknown
  quantityUnit: string | null
  normalizedUnit: string | null
}

/** The price row's history, newest first; `exhausted` when it was read to its start. */
export type PriceLineTimeline = {
  entries: readonly PriceHistoryEntry[]
  exhausted: boolean
}

/** Proposed amounts in units of 10^-4 (null: not proposed). */
export type PriceLineProposalAmounts = {
  currencyCode: string
  unitPriceNet: bigint | null
  unitPriceGross: bigint | null
}

/** Revenues (unit price × quantity as stored) are in units of 10^-8 and set for `priced_from_row` only. */
export type PriceLineClassification = {
  outcome: PriceLineOutcomeKind
  basis: PriceBasis
  reason: PriceLineUnverifiableReason | null
  currentRevenue: bigint | null
  simulatedRevenue: bigint | null
}

const UNIT_FACTOR = BigInt(10_000)

function readTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function normalizeUnit(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Whether the unit price was entered per a unit other than the base unit: the browser dialog then
 * multiplies the row amount by the unit factor, so the stored price is not comparable with it.
 */
export function hasPriceUnitConversion(line: Pick<PriceLineRecord, 'uomFactor' | 'quantityUnit' | 'normalizedUnit'>): boolean {
  const factor = toScaledAmount(line.uomFactor)
  if (factor !== null) return factor !== UNIT_FACTOR
  const entered = normalizeUnit(line.quantityUnit)
  const base = normalizeUnit(line.normalizedUnit)
  return entered !== null && base !== null && entered !== base
}

/** The row's state at `atMs` from its timeline, exactly as `readPriceAmountAsOf` reads it from audit history. */
export function priceAmountAt(timeline: PriceLineTimeline, atMs: number, basis: PriceBasis): PriceAmountAsOf {
  const scan = startPriceAmountHistoryScan(atMs, basis)
  return scanPriceAmountHistoryPage(scan, timeline.entries) ?? finishPriceAmountHistoryScan(scan, timeline.exhausted)
}

/**
 * Why the timeline cannot show the row's amount at `atMs` (`priceAmountAt` answered `unknown`),
 * following the same newest-first scan: a change within the tolerance, the truncated history, or
 * an entry the timeline cannot read.
 */
export function unknownPriceAmountReason(timeline: PriceLineTimeline, atMs: number): PriceLineUnverifiableReason {
  for (const entry of timeline.entries) {
    if (entry.executionState === 'failed') continue
    const at = readTime(entry.at)
    if (at === null) return 'price_amount_unknown'
    if (Math.abs(at - atMs) <= PRICE_HISTORY_ORDER_TOLERANCE_MS) return 'price_change_within_tolerance'
    if (at < atMs) return 'price_amount_unknown'
  }
  return timeline.exhausted ? 'price_amount_unknown' : 'price_history_truncated'
}

/**
 * Whether the line, edited after it was created, may have been re-priced from the row at an
 * edit: the row changed during the line's life to an amount equal to the line's (same currency), or
 * to a state the timeline cannot read. A line whose price matches no amount the row had is a
 * manual override.
 */
export function mayHaveBeenRepricedAtEdit(
  timeline: PriceLineTimeline,
  createdMs: number,
  updatedAt: string | null,
  basis: PriceBasis,
  lineAmount: bigint,
  lineCurrency: string,
): boolean {
  const updatedMs = readTime(updatedAt)
  if (updatedMs === null || updatedMs <= createdMs + PRICE_HISTORY_ORDER_TOLERANCE_MS) return false
  for (const entry of timeline.entries) {
    if (entry.executionState === 'failed') continue
    const at = readTime(entry.at)
    if (at === null) return true
    if (at <= createdMs || at > updatedMs + PRICE_HISTORY_ORDER_TOLERANCE_MS) continue
    const state = stateFromEntryAfter(entry, basis)
    if (state.status === 'unknown') return true
    if (state.status !== 'found') continue
    if (state.state.amount !== null && state.state.amount === lineAmount && state.state.currencyCode === lineCurrency) return true
  }
  return false
}

function sameAmount(state: PriceAmountAsOf, lineAmount: bigint, lineCurrency: string): boolean {
  return state.status === 'found' && state.state.amount !== null && state.state.amount === lineAmount && state.state.currencyCode === lineCurrency
}

/**
 * Whether the row had the line's amount (same currency) at any time before the line was created:
 * the price may come from the row at that earlier time (a quote converted to an order keeps its
 * lines' prices but dates them at the conversion; a line dialog opened earlier keeps the price it
 * loaded). The state before the oldest entry counts when the whole history was read.
 */
export function matchesEarlierRowAmount(
  timeline: PriceLineTimeline,
  createdMs: number,
  basis: PriceBasis,
  lineAmount: bigint,
  lineCurrency: string,
): boolean {
  let oldest: PriceLineTimeline['entries'][number] | null = null
  for (const entry of timeline.entries) {
    if (entry.executionState === 'failed') continue
    oldest = entry
    const at = readTime(entry.at)
    if (at === null || at >= createdMs) continue
    if (sameAmount(stateFromEntryAfter(entry, basis), lineAmount, lineCurrency)) return true
  }
  return Boolean(timeline.exhausted && oldest && sameAmount(stateBeforeOldestEntry(oldest, basis), lineAmount, lineCurrency))
}

/**
 * Classifies one line against the row's timeline and the proposal. A line priced from the row is
 * re-priced only in the proposal's currency (no FX) and only in a basis the proposal sets; its
 * revenues are unit price × quantity as stored (quantities constant).
 */
export function classifyPriceLine(
  line: PriceLineRecord,
  timeline: PriceLineTimeline,
  proposal: PriceLineProposalAmounts,
  displayBasis: PriceBasis | null,
): PriceLineClassification {
  const mode = readLinePriceMode(line.priceMode)
  const basis: PriceBasis = mode ?? displayBasis ?? 'net'
  const cannotTell = (reason: PriceLineUnverifiableReason): PriceLineClassification => ({
    outcome: 'cannot_tell',
    basis,
    reason,
    currentRevenue: null,
    simulatedRevenue: null,
  })
  if (!mode) return cannotTell('price_mode_unknown')
  if (hasPriceUnitConversion(line)) return cannotTell('unit_conversion')
  const lineAmount = toScaledAmount(basis === 'gross' ? line.unitPriceGross : line.unitPriceNet)
  const quantity = toScaledAmount(line.quantity)
  const createdMs = readTime(line.createdAt)
  if (lineAmount === null || quantity === null || createdMs === null) return cannotTell('line_amount_missing')
  const atCreation = priceAmountAt(timeline, createdMs, basis)
  if (atCreation.status === 'unknown') return cannotTell(unknownPriceAmountReason(timeline, createdMs))
  if (atCreation.status === 'absent') return cannotTell('price_absent_at_write')
  const lineCurrency = normalizeCurrency(line.currencyCode)
  if (!lineCurrency || !atCreation.state.currencyCode || lineCurrency !== atCreation.state.currencyCode) return cannotTell('currency_mismatch')
  if (atCreation.state.amount === null) return cannotTell('price_amount_missing')
  if (compareScaledAmounts(lineAmount, atCreation.state.amount) !== 0) {
    if (mayHaveBeenRepricedAtEdit(timeline, createdMs, line.updatedAt, basis, lineAmount, lineCurrency)) {
      return cannotTell('row_changed_while_line_edited')
    }
    if (matchesEarlierRowAmount(timeline, createdMs, basis, lineAmount, lineCurrency)) return cannotTell('matches_earlier_row_amount')
    if (!timeline.exhausted) return cannotTell('price_history_truncated')
    return { outcome: 'manual_override', basis, reason: null, currentRevenue: null, simulatedRevenue: null }
  }
  if (lineCurrency !== normalizeCurrency(proposal.currencyCode)) return cannotTell('currency_differs_from_proposal')
  const proposed = basis === 'gross' ? proposal.unitPriceGross : proposal.unitPriceNet
  if (proposed === null) return cannotTell('basis_not_proposed')
  return {
    outcome: 'priced_from_row',
    basis,
    reason: null,
    currentRevenue: lineAmount * quantity,
    simulatedRevenue: proposed * quantity,
  }
}
