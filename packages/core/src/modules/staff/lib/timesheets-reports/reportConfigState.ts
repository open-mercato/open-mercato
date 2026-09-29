/**
 * D-4 made executable: a period preset FILLS an editable From/To pair, and the
 * moment either date is moved by hand the report's `period_kind` becomes
 * `custom`.
 *
 * The mockup drew fixed Week / Month / Year buttons and §8 described the same,
 * but consulting invoices rarely stop at a calendar boundary — the screen 13
 * example is itself a 1 June – 19 July range. Rather than choosing between the
 * two, the preset is a shortcut that seeds the dates and then gets out of the
 * way. Keeping the preset highlighted after the user moved a date would be a
 * lie about what is going to be reported, so it is dropped rather than kept.
 */

import { resolvePeriodRange, todayIso, type TimesheetDateRange } from '../time-tracking-ui/timesheetPeriod'

export type ReportPeriodKind = 'week' | 'month' | 'year' | 'custom'

export const REPORT_PERIOD_PRESETS: readonly Exclude<ReportPeriodKind, 'custom'>[] = ['week', 'month', 'year']

export type ReportPeriodState = {
  kind: ReportPeriodKind
  from: string
  to: string
}

export function isReportPeriodPreset(value: unknown): value is Exclude<ReportPeriodKind, 'custom'> {
  return value === 'week' || value === 'month' || value === 'year'
}

export function presetRange(
  kind: Exclude<ReportPeriodKind, 'custom'>,
  anchorIso: string = todayIso(),
): TimesheetDateRange {
  return resolvePeriodRange(kind, anchorIso)
}

export function initialReportPeriod(anchorIso: string = todayIso()): ReportPeriodState {
  const range = presetRange('month', anchorIso)
  return { kind: 'month', from: range.from, to: range.to }
}

/** Applying a preset replaces both dates and restores the preset kind. */
export function applyPreset(
  state: ReportPeriodState,
  kind: Exclude<ReportPeriodKind, 'custom'>,
  anchorIso: string = todayIso(),
): ReportPeriodState {
  // Anchor on the range the user is already looking at so "Month" next to a
  // June range means June, not whatever month it happens to be today.
  const anchor = state.from || anchorIso
  const range = presetRange(kind, anchor)
  return { kind, from: range.from, to: range.to }
}

/**
 * Moving a bound by hand. The kind drops to `custom` only when the date actually
 * changed, so re-typing the same value does not silently relabel the period.
 */
export function applyBound(
  state: ReportPeriodState,
  bound: 'from' | 'to',
  value: string,
): ReportPeriodState {
  const current = bound === 'from' ? state.from : state.to
  if (value === current) return state
  const next: ReportPeriodState = { ...state, [bound]: value } as ReportPeriodState
  next.kind = 'custom'
  return next
}

export function isValidReportPeriod(state: ReportPeriodState): boolean {
  if (!state.from || !state.to) return false
  return state.to >= state.from
}

/** The period spans more than one calendar month, which screen 13 calls out. */
export function spansMultipleMonths(state: ReportPeriodState): boolean {
  if (!state.from || !state.to) return false
  return state.from.slice(0, 7) !== state.to.slice(0, 7)
}

export function defaultReportTitle(
  customerName: string | null,
  period: ReportPeriodState,
  fallbackCustomer: string,
): string {
  const name = customerName && customerName.trim().length > 0 ? customerName.trim() : fallbackCustomer
  return `${name} · ${period.from} – ${period.to}`
}
