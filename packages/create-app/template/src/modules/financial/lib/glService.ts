import { FinancialRuleError, type FinancialErrorCode } from './errors'
import type { JournalEntryStatus, PeriodStatus } from '../data/entities'

/**
 * The ledger's rules, as pure functions.
 *
 * Money is handled as integer minor units on a 4-decimal scale, parsed from the
 * decimal string the caller wrote rather than from its binary approximation:
 * `Math.round(1.005 * 100)` is `100` because `1.005` is stored as `1.00499999…`,
 * so float arithmetic is a halala off the amount the operator meant. Every rule a
 * command needs — is it balanced, is it editable, may it post here — is decided
 * here, so no route re-implements one and a unit test needs no database.
 */

export const MINOR_UNIT_SCALE = 4

const MINOR_UNIT_FACTOR = 10n ** BigInt(MINOR_UNIT_SCALE)
const AMOUNT_PATTERN = /^([+-]?)(\d*)(?:\.(\d*))?$/

export function toMinorUnits(value: string | number): bigint {
  const text = typeof value === 'number' ? toDecimalString(value) : value.trim()
  const match = AMOUNT_PATTERN.exec(text)
  if (!match) throw new FinancialRuleError('invalid_amount')
  const [, sign, whole = '', fraction = ''] = match
  if (whole === '' && fraction === '') throw new FinancialRuleError('invalid_amount')
  const magnitude = BigInt(whole === '' ? '0' : whole) * MINOR_UNIT_FACTOR + fractionToMinorUnits(fraction)
  return sign === '-' ? -magnitude : magnitude
}

export function fromMinorUnits(value: bigint): string {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const whole = magnitude / MINOR_UNIT_FACTOR
  const fraction = (magnitude % MINOR_UNIT_FACTOR).toString().padStart(MINOR_UNIT_SCALE, '0')
  return `${negative ? '-' : ''}${whole}.${fraction}`
}

function fractionToMinorUnits(fraction: string): bigint {
  const padded = `${fraction}00000`
  const kept = padded.slice(0, MINOR_UNIT_SCALE)
  const guard = padded.charAt(MINOR_UNIT_SCALE)
  const units = BigInt(kept)
  return Number(guard) >= 5 ? units + 1n : units
}

function toDecimalString(value: number): string {
  if (!Number.isFinite(value)) throw new FinancialRuleError('invalid_amount')
  const text = String(value)
  if (text.includes('e') || text.includes('E')) throw new FinancialRuleError('invalid_amount')
  return text
}

export type JournalLineDraft = {
  accountId: string
  debitAmount: string | number
  creditAmount: string | number
  description?: string | null
  taxCode?: string | null
}

export type JournalLineTotals = { debit: bigint; credit: bigint }

export function sumJournalLines(lines: readonly JournalLineDraft[]): JournalLineTotals {
  let debit = 0n
  let credit = 0n
  for (const line of lines) {
    debit += toMinorUnits(line.debitAmount)
    credit += toMinorUnits(line.creditAmount)
  }
  return { debit, credit }
}

/** Invariants 1-3: at least two lines, single-sided lines, and a balanced entry. */
export function assertJournalEntryRules(lines: readonly JournalLineDraft[]): void {
  if (lines.length < 2) throw new FinancialRuleError('entry_requires_two_lines')
  for (const line of lines) {
    if (!line.accountId) throw new FinancialRuleError('line_account_required')
    const debit = toMinorUnits(line.debitAmount)
    const credit = toMinorUnits(line.creditAmount)
    if (debit < 0n || credit < 0n) throw new FinancialRuleError('negative_amount')
    const singleSided = (debit > 0n && credit === 0n) || (credit > 0n && debit === 0n)
    if (!singleSided) throw new FinancialRuleError('entry_line_single_sided')
  }
  const { debit, credit } = sumJournalLines(lines)
  if (debit !== credit) throw new FinancialRuleError('entry_unbalanced')
}

/** Invariant 4: a posted entry is never edited; the correction path is a reversal. */
export function assertEntryEditable(status: JournalEntryStatus): void {
  if (status !== 'draft') throw new FinancialRuleError('entry_immutable')
}

export function assertEntryPostable(status: JournalEntryStatus): void {
  if (status !== 'draft') throw new FinancialRuleError('entry_not_draft')
}

/** Invariant 5: period gating. `soft_closed` needs the elevated permission. */
export function evaluatePeriodPosting(
  status: PeriodStatus,
  hasClosePermission: boolean,
): { allowed: true } | { allowed: false; code: FinancialErrorCode } {
  if (status === 'open') return { allowed: true }
  if (status === 'soft_closed') {
    return hasClosePermission ? { allowed: true } : { allowed: false, code: 'period_closed' }
  }
  return { allowed: false, code: 'period_hard_closed' }
}

export function assertPeriodReopenable(status: PeriodStatus): void {
  if (status !== 'soft_closed') throw new FinancialRuleError('period_not_reopenable')
}

/** The mirror of an entry: debits and credits swapped, account and tax code kept. */
export function buildReversalLines(lines: readonly JournalLineDraft[]): JournalLineDraft[] {
  return lines.map((line) => ({
    accountId: line.accountId,
    debitAmount: line.creditAmount,
    creditAmount: line.debitAmount,
    description: line.description ?? null,
    taxCode: line.taxCode ?? null,
  }))
}

export type TrialBalanceInputRow = {
  accountId: string
  debitAmount: string | number
  creditAmount: string | number
}

export type TrialBalanceLine = { accountId: string; debit: string; credit: string }

export function buildTrialBalance(rows: readonly TrialBalanceInputRow[]): TrialBalanceLine[] {
  const totals = new Map<string, { debit: bigint; credit: bigint }>()
  for (const row of rows) {
    const bucket = totals.get(row.accountId) ?? { debit: 0n, credit: 0n }
    bucket.debit += toMinorUnits(row.debitAmount)
    bucket.credit += toMinorUnits(row.creditAmount)
    totals.set(row.accountId, bucket)
  }
  return [...totals.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([accountId, value]) => ({
      accountId,
      debit: fromMinorUnits(value.debit),
      credit: fromMinorUnits(value.credit),
    }))
}

export function isTrialBalanceBalanced(lines: readonly TrialBalanceLine[]): boolean {
  let debit = 0n
  let credit = 0n
  for (const line of lines) {
    debit += toMinorUnits(line.debit)
    credit += toMinorUnits(line.credit)
  }
  return debit === credit
}

