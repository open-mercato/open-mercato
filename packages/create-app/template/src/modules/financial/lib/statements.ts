/**
 * The two statements an owner asks for — what we own and owe, and whether we
 * made money — as pure read models over posted lines.
 *
 * Nothing here reads the database: the ledger service hands back per-account
 * movements (see `loadAccountMovements`) and these builders turn them into a
 * balance sheet and an income statement. Keeping the arithmetic out of the route
 * is what makes "does it balance" a property of the numbers rather than of a
 * request, and it is why the whole file is unit-testable without a database.
 *
 * Money never becomes a float: every amount is parsed to integer minor units at
 * the ledger's 4-decimal scale and formatted back to a decimal string.
 */
import type { AccountClass, NormalBalance } from '../data/entities'
import { FinancialRuleError } from './errors'
import { fromMinorUnits, toMinorUnits } from './glService'

/** The movement shape the ledger service reports per account, debit/credit as decimal strings. */
export type AccountMovement = {
  accountId: string
  code: string
  name: string
  accountClass: AccountClass
  normalBalance: NormalBalance
  debit: string
  credit: string
}

export type StatementAccountRow = {
  accountId: string
  code: string
  name: string
  accountClass: AccountClass
  debit: string
  credit: string
}

export type StatementSection = {
  accountClass: AccountClass
  rows: StatementAccountRow[]
  /** The net of the rows on the section's normal side; a negative figure means the section is a net liability to itself. */
  total: string
}

export type BalanceSheet = {
  asOf: string
  currencyCode: string
  assets: StatementSection
  liabilities: StatementSection
  equity: StatementSection
  totalAssets: string
  totalLiabilitiesAndEquity: string
  balanced: boolean
  netIncome: string
}

export type IncomeStatement = {
  from: string
  to: string
  currencyCode: string
  revenue: StatementSection
  expenses: StatementSection
  totalRevenue: string
  totalExpenses: string
  netIncome: string
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** A date the ledger can be read at: `YYYY-MM-DD`, and a day that exists. */
export function isStatementDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return false
  // 2026-02-31 parses into March, so the round trip is what rejects it.
  return parsed.toISOString().slice(0, 10) === value
}

/**
 * A range whose end precedes its start is not an empty range, it is a caller
 * mistake; the statement refuses to be a confusing zero. Whether a date is
 * well-formed is the caller's input validation (`isStatementDate`), not a
 * property of the statement, so it is not checked here.
 */
export function assertStatementRange(from: string, to: string): void {
  if (!isStatementDate(from) || !isStatementDate(to) || to < from) {
    throw new FinancialRuleError('statement_range_invalid')
  }
}

/**
 * The account's balance on its *normal* side, from the stored `normalBalance`
 * rather than from its class.
 *
 * For every chart this module seeds the two agree — assets and expenses are
 * debit-normal, liabilities, equity and revenue credit-normal — and that is the
 * only reason the class-based shortcut is tempting. They stop agreeing the moment
 * a tenant adds a contra account (accumulated depreciation is an asset that is
 * credit-normal, a sales-returns line is revenue that is debit-normal), and then
 * the stored value is the one that matches the chart the postings were written
 * against. The class is used for presentation (which section a row belongs to),
 * never for the sign.
 */
function netBalance(movement: AccountMovement): bigint {
  const debit = toMinorUnits(movement.debit)
  const credit = toMinorUnits(movement.credit)
  return movement.normalBalance === 'debit' ? debit - credit : credit - debit
}

/**
 * A row is presented on the side its balance falls on, so a negative net is shown
 * on the opposite side rather than as a negative figure. A contra-asset row then
 * reads the way an accountant expects to see it.
 */
function toRow(movement: AccountMovement, net: bigint): StatementAccountRow {
  const normalSideIsDebit = movement.normalBalance === 'debit'
  const onDebitSide = normalSideIsDebit ? net >= 0n : net < 0n
  const magnitude = net < 0n ? -net : net
  return {
    accountId: movement.accountId,
    code: movement.code,
    name: movement.name,
    accountClass: movement.accountClass,
    debit: onDebitSide && magnitude !== 0n ? fromMinorUnits(magnitude) : '0.0000',
    credit: !onDebitSide && magnitude !== 0n ? fromMinorUnits(magnitude) : '0.0000',
  }
}

type NettedMovement = { movement: AccountMovement; net: bigint }

/**
 * A section totals on **its own natural side**, taken from the presented rows:
 * `debit − credit` for assets and expenses, `credit − debit` for liabilities,
 * equity and revenue.
 *
 * Summing each account's own-normal-side balance instead — which is what this did
 * first — is the same number only while every account in the section is normal on
 * the same side. A single contra account breaks it: 1 000 of cash and 250 of
 * accumulated depreciation (a credit-normal asset) totalled 1 250 and reported
 * `balanced: false` on a ledger that was perfectly correct, turning the sheet's
 * one real signal into a false alarm. Reading the total off the presented sides
 * makes a contra row subtract, which is what an accountant sees on the page.
 */
function buildSection(accountClass: AccountClass, netted: readonly NettedMovement[]): StatementSection {
  const naturalSideIsDebit = accountClass === 'asset' || accountClass === 'expense'
  const rows: StatementAccountRow[] = []
  let total = 0n
  for (const entry of netted) {
    if (entry.movement.accountClass !== accountClass) continue
    // A zero balance is not a line on a statement; a chart with fifty accounts
    // would otherwise print forty rows of nothing.
    if (entry.net === 0n) continue
    const row = toRow(entry.movement, entry.net)
    rows.push(row)
    const debit = toMinorUnits(row.debit)
    const credit = toMinorUnits(row.credit)
    total += naturalSideIsDebit ? debit - credit : credit - debit
  }
  rows.sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0))
  return { accountClass, rows, total: fromMinorUnits(total) }
}

function sectionTotal(section: StatementSection): bigint {
  return toMinorUnits(section.total)
}

function netMovements(movements: readonly AccountMovement[]): NettedMovement[] {
  return movements.map((movement) => ({ movement, net: netBalance(movement) }))
}

/**
 * The sheet as of a date.
 *
 * It balances without a closing entry having been run because the period's result
 * is bridged in: revenue and expense movement up to `asOf` is `netIncome`, and
 * `totalLiabilitiesAndEquity` counts it alongside the equity accounts. The equity
 * *section* reports the equity accounts as posted, so a section total stays the
 * sum of its rows and `netIncome` is the line a statement renders as retained
 * earnings — the amount belongs to the arithmetic, the label to the caller.
 *
 * A sheet that does not balance is reported with `balanced: false` and its real
 * numbers. It is never plugged and never throws: the difference is the finding.
 */
export function buildBalanceSheet(
  movements: readonly AccountMovement[],
  params: { asOf: string; currencyCode: string },
): BalanceSheet {
  const netted = netMovements(movements)
  const assets = buildSection('asset', netted)
  const liabilities = buildSection('liability', netted)
  const equity = buildSection('equity', netted)
  const revenue = buildSection('revenue', netted)
  const expenses = buildSection('expense', netted)
  const netIncome = sectionTotal(revenue) - sectionTotal(expenses)
  const totalAssets = sectionTotal(assets)
  const totalLiabilitiesAndEquity = sectionTotal(liabilities) + sectionTotal(equity) + netIncome
  return {
    asOf: params.asOf,
    currencyCode: params.currencyCode,
    assets,
    liabilities,
    equity,
    totalAssets: fromMinorUnits(totalAssets),
    totalLiabilitiesAndEquity: fromMinorUnits(totalLiabilitiesAndEquity),
    balanced: totalAssets === totalLiabilitiesAndEquity,
    netIncome: fromMinorUnits(netIncome),
  }
}

/**
 * The result for a range. A loss is a negative `netIncome` rather than a sign a
 * caller has to infer from the direction of the totals.
 */
export function buildIncomeStatement(
  movements: readonly AccountMovement[],
  params: { from: string; to: string; currencyCode: string },
): IncomeStatement {
  assertStatementRange(params.from, params.to)
  const netted = netMovements(movements)
  const revenue = buildSection('revenue', netted)
  const expenses = buildSection('expense', netted)
  const totalRevenue = sectionTotal(revenue)
  const totalExpenses = sectionTotal(expenses)
  const netIncome = totalRevenue - totalExpenses
  return {
    from: params.from,
    to: params.to,
    currencyCode: params.currencyCode,
    revenue,
    expenses,
    totalRevenue: fromMinorUnits(totalRevenue),
    totalExpenses: fromMinorUnits(totalExpenses),
    netIncome: fromMinorUnits(netIncome),
  }
}
