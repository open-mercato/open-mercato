/**
 * Totals for the WHOLE filtered set of time entries, not the page on screen.
 *
 * The list route answers `?includeTotals=true` with one extra aggregate query
 * over the same scoped filters the list itself runs (`buildScopedTimeEntryListFilters`),
 * so the footer can say "Total for these 300 entries" instead of silently summing
 * the 50 rows of the current page.
 *
 * The filters are the column-keyed shape the CRUD query engine consumes. Only the
 * operators that shape actually uses are compiled; anything else throws, and the
 * route then omits `totals` rather than answering a different question than the
 * list did.
 *
 * Money is produced by `entryAmountExact` at the currency's configured decimals,
 * as the row `cost` values are, and summed exactly, so the total always equals
 * the sum of the row costs. PostgreSQL only groups the billable, priced entries
 * by currency, rounded minutes and both rates, and counts them; the amounts are
 * priced here so SQL rounding cannot differ from the rows. The currency is the
 * entry's snapshot currency or else the project's; currencies are never added
 * together.
 */

import { sql, type Expression, type ExpressionBuilder, type Kysely, type SqlBool } from 'kysely'
import { addDecimals, decimalToNumber, decimalToString, multiplyDecimals, parseDecimal } from '@open-mercato/shared/lib/decimal'
import { DEFAULT_STAFF_AMOUNT_DECIMAL_PLACES, entryAmountExact } from '../time-tracking/cost'

export type TimeEntryMoneyTotal = {
  currencyCode: string | null
  /** Float copy of `amountExact`; prefer the exact field. */
  amount: number
  amountExact?: string
}

export type TimeEntryTotals = {
  entryCount: number
  durationMinutes: number
  roundedMinutes: number
  /** Present only for a caller holding `staff.timesheets.rates.view`. */
  money?: TimeEntryMoneyTotal[]
}

type TotalsDb = {
  staff_time_entries: {
    id: string
    tenant_id: string
    organization_id: string
    staff_member_id: string
    date: string
    duration_minutes: number
    rounded_minutes: number | null
    started_at: string | null
    ended_at: string | null
    notes: string | null
    time_project_id: string | null
    task_id: string | null
    customer_id: string | null
    is_billable: boolean
    rate_override_amount: string | null
    rate_currency_code: string | null
    locked_report_id: string | null
    deleted_at: string | null
  }
  staff_time_projects: {
    id: string
    tenant_id: string
    organization_id: string
    hourly_rate: string | null
    currency_code: string | null
    deleted_at: string | null
  }
}

const FILTERABLE_COLUMNS = new Set([
  'id',
  'staff_member_id',
  'date',
  'duration_minutes',
  'rounded_minutes',
  'started_at',
  'ended_at',
  'notes',
  'time_project_id',
  'task_id',
  'customer_id',
  'is_billable',
  'locked_report_id',
])

type FilterableColumn = `e.${keyof TotalsDb['staff_time_entries']}`
type EntryExpressionBuilder = ExpressionBuilder<{ e: TotalsDb['staff_time_entries'] }, 'e'>

const COMPARISON_OPERATORS: Record<string, '>=' | '<=' | '>' | '<'> = {
  $gte: '>=',
  $lte: '<=',
  $gt: '>',
  $lt: '<',
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

function compileColumnCondition(
  eb: EntryExpressionBuilder,
  column: string,
  condition: unknown,
): Expression<SqlBool> {
  if (!FILTERABLE_COLUMNS.has(column)) {
    throw new Error(`[internal] time entry totals: unsupported filter column "${column}"`)
  }
  const ref = `e.${column}` as FilterableColumn
  if (condition === null) return eb(ref, 'is', null)
  if (!isPlainObject(condition)) return eb(ref, '=', condition as never)
  const parts: Expression<SqlBool>[] = []
  for (const [operator, operand] of Object.entries(condition)) {
    if (operator === '$eq') {
      parts.push(operand === null ? eb(ref, 'is', null) : eb(ref, '=', operand as never))
    } else if (operator === '$ne') {
      parts.push(operand === null ? eb(ref, 'is not', null) : eb(ref, '<>', operand as never))
    } else if (operator === '$in') {
      if (!Array.isArray(operand)) throw new Error('[internal] time entry totals: $in needs an array')
      parts.push(operand.length === 0 ? sql<SqlBool>`false` : eb(ref, 'in', operand as never[]))
    } else if (operator in COMPARISON_OPERATORS) {
      parts.push(eb(ref, COMPARISON_OPERATORS[operator], operand as never))
    } else if (operator === '$ilike') {
      parts.push(eb(ref, 'ilike', operand as never))
    } else {
      throw new Error(`[internal] time entry totals: unsupported filter operator "${operator}"`)
    }
  }
  return parts.length === 1 ? parts[0] : eb.and(parts)
}

export function compileTimeEntryFilters(
  eb: EntryExpressionBuilder,
  filters: Record<string, unknown>,
): Expression<SqlBool> {
  const parts: Expression<SqlBool>[] = []
  for (const [key, condition] of Object.entries(filters)) {
    if (condition === undefined) continue
    if (key === '$or' || key === '$and') {
      if (!Array.isArray(condition) || condition.some((branch) => !isPlainObject(branch))) {
        throw new Error(`[internal] time entry totals: ${key} needs an array of filter objects`)
      }
      const branches = condition.map((branch) => compileTimeEntryFilters(eb, branch as Record<string, unknown>))
      if (key === '$or') parts.push(branches.length === 0 ? sql<SqlBool>`false` : eb.or(branches))
      else parts.push(...branches)
      continue
    }
    parts.push(compileColumnCondition(eb, key, condition))
  }
  if (parts.length === 0) return sql<SqlBool>`true`
  return parts.length === 1 ? parts[0] : eb.and(parts)
}

export type TimeEntryTotalsScope = {
  tenantId: string
  /** Organizations the list itself is scoped to; an empty list matches nothing. */
  organizationIds: string[]
  canSeeRates: boolean
  /** Mirrors the list's `withDeleted=true`: soft-deleted entries are counted too. */
  includeDeleted?: boolean
  /** Configured decimals of a currency, as the row costs use; 2 when omitted. */
  resolveDecimalPlaces?: (currencyCode: string) => Promise<number>
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toNullableAmount(value: unknown): string | null {
  const parsed = parseDecimal(value)
  return parsed ? decimalToString(parsed) : null
}

function readCurrencyCode(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function baseQuery(db: Kysely<TotalsDb>, filters: Record<string, unknown>, scope: TimeEntryTotalsScope) {
  const scoped = db
    .selectFrom('staff_time_entries as e')
    .where('e.tenant_id', '=', scope.tenantId)
    .where('e.organization_id', 'in', scope.organizationIds)
  const live = scope.includeDeleted ? scoped : scoped.where('e.deleted_at', 'is', null)
  return live.where((eb) => compileTimeEntryFilters(eb as unknown as EntryExpressionBuilder, filters))
}

export function buildTimeEntryTotalsQuery(
  db: Kysely<TotalsDb>,
  filters: Record<string, unknown>,
  scope: TimeEntryTotalsScope,
) {
  return baseQuery(db, filters, scope).select([
    sql<string>`count(*)`.as('entry_count'),
    sql<string>`coalesce(sum(e.duration_minutes), 0)`.as('duration_minutes'),
    sql<string>`coalesce(sum(e.rounded_minutes), 0)`.as('rounded_minutes'),
  ])
}

export function buildTimeEntryMoneyTotalsQuery(
  db: Kysely<TotalsDb>,
  filters: Record<string, unknown>,
  scope: TimeEntryTotalsScope,
) {
  return baseQuery(db, filters, scope)
    .leftJoin('staff_time_projects as p', (join) =>
      join
        .onRef('p.id', '=', 'e.time_project_id')
        .onRef('p.tenant_id', '=', 'e.tenant_id')
        .onRef('p.organization_id', '=', 'e.organization_id')
        .on('p.deleted_at', 'is', null),
    )
    .where('e.is_billable', '=', true)
    .where(sql<SqlBool>`coalesce(e.rate_override_amount, p.hourly_rate) is not null`)
    .select([
      sql<string | null>`coalesce(nullif(trim(e.rate_currency_code), ''), p.currency_code)`.as('currency_code'),
      sql<string>`coalesce(e.rounded_minutes, 0)`.as('rounded_minutes'),
      sql<string | null>`e.rate_override_amount`.as('rate_override_amount'),
      sql<string | null>`p.hourly_rate`.as('hourly_rate'),
      sql<string>`count(*)`.as('entry_count'),
    ])
    .groupBy([
      sql`coalesce(nullif(trim(e.rate_currency_code), ''), p.currency_code)`,
      sql`coalesce(e.rounded_minutes, 0)`,
      sql`e.rate_override_amount`,
      sql`p.hourly_rate`,
    ])
    .orderBy(sql`coalesce(nullif(trim(e.rate_currency_code), ''), p.currency_code)`)
}

type MoneyGroupRow = {
  currency_code: string | null
  rounded_minutes: unknown
  rate_override_amount: unknown
  hourly_rate: unknown
  entry_count: unknown
}

export function sumTimeEntryMoneyGroups(
  groups: readonly MoneyGroupRow[],
  decimalPlacesByCurrency: Readonly<Record<string, number>> = {},
): TimeEntryMoneyTotal[] {
  const totalByCurrency = new Map<string | null, string>()
  for (const group of groups) {
    const currencyCode = readCurrencyCode(group.currency_code)
    const amount = entryAmountExact(
      {
        isBillable: true,
        roundedMinutes: toNumber(group.rounded_minutes),
        rateOverrideAmount: toNullableAmount(group.rate_override_amount),
      },
      { hourlyRate: toNullableAmount(group.hourly_rate) },
      null,
      (currencyCode ? decimalPlacesByCurrency[currencyCode] : undefined) ?? DEFAULT_STAFF_AMOUNT_DECIMAL_PLACES,
    )
    if (amount === null) continue
    const groupTotal = multiplyDecimals(amount, toNumber(group.entry_count))
    totalByCurrency.set(currencyCode, decimalToString(addDecimals(totalByCurrency.get(currencyCode) ?? '0', groupTotal)))
  }
  return Array.from(totalByCurrency, ([currencyCode, amountExact]) => ({
    currencyCode,
    amount: decimalToNumber(amountExact),
    amountExact,
  }))
}

async function resolveGroupDecimalPlaces(
  groups: readonly MoneyGroupRow[],
  resolveDecimalPlaces: TimeEntryTotalsScope['resolveDecimalPlaces'],
): Promise<Record<string, number>> {
  if (!resolveDecimalPlaces) return {}
  const codes = Array.from(new Set(groups.flatMap((group) => {
    const code = readCurrencyCode(group.currency_code)
    return code ? [code] : []
  })))
  return Object.fromEntries(await Promise.all(codes.map(async (code) => [code, await resolveDecimalPlaces(code)] as const)))
}

export async function computeTimeEntryTotals(
  db: Kysely<unknown>,
  filters: Record<string, unknown>,
  scope: TimeEntryTotalsScope,
): Promise<TimeEntryTotals> {
  const typedDb = db as unknown as Kysely<TotalsDb>
  if (scope.organizationIds.length === 0) {
    return { entryCount: 0, durationMinutes: 0, roundedMinutes: 0, ...(scope.canSeeRates ? { money: [] } : {}) }
  }
  const row = await buildTimeEntryTotalsQuery(typedDb, filters, scope).executeTakeFirst()
  const totals: TimeEntryTotals = {
    entryCount: toNumber(row?.entry_count),
    durationMinutes: toNumber(row?.duration_minutes),
    roundedMinutes: toNumber(row?.rounded_minutes),
  }
  if (!scope.canSeeRates) return totals
  const groups = await buildTimeEntryMoneyTotalsQuery(typedDb, filters, scope).execute()
  totals.money = sumTimeEntryMoneyGroups(groups, await resolveGroupDecimalPlaces(groups, scope.resolveDecimalPlaces))
  return totals
}
