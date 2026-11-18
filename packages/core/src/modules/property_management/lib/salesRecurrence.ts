import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { InvalidFieldNameException, TableNotFoundException } from '@mikro-orm/core'
import { commandRegistry, type CommandBus } from '@open-mercato/shared/lib/commands'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { buildTrustedSalesContext } from './salesCommandContext'
import { SalesContractUnavailableError } from './salesErrors'
import {
  readOrderRecurrenceRow,
  readOrderRecurrenceRows,
  readRecurringPeriodRows,
  readRecurringPeriodRowsByOrder,
  type OrderRecurrenceRow,
  type RecurringPeriodRow,
} from './salesLookups'
import { compareIsoDates } from './leaseTerm'
import type { Scope } from './productUse'

export const SALES_RECURRENCE_CANCEL_COMMAND = 'sales.orders.recurrence.cancel'
export const SALES_RECURRENCE_CANCEL_ALLOW_CREDIT_CAPABILITY = 'allowCredit'
export const CANCEL_SETTLEMENTS = ['prorate', 'credit_full', 'keep'] as const
export type CancelSettlement = (typeof CANCEL_SETTLEMENTS)[number]
export const FALLBACK_CANCEL_SETTLEMENT: CancelSettlement = 'keep'

export type CancelRecurrenceInput = {
  orderId: string
  effectiveOn: string
  settlement: CancelSettlement
  idempotencyKey: string
  scheduleVersion: number | null
  allowCredit: boolean
}

export type CancelRecurrenceResult = {
  status: string | null
  cancelEffectiveOn: string | null
  creditMemoIds: string[]
}

export type RecurrencePeriod = RecurringPeriodRow

export type RecurrenceRead = {
  orderId: string
  status: string
  startsOn: string
  periodCount: number | null
  endsOn: string | null
  nextPeriodIndex: number
  nextInvoiceOn: string | null
  scheduleVersion: number
  cancelEffectiveOn: string | null
  cancelSettlement: string | null
  periods: RecurrencePeriod[]
  invoicesAvailable: boolean
}

export type CreditPreview = {
  wouldCredit: boolean
  fullyCreditedPeriods: number[]
  finalPeriodIndex: number | null
  finalPeriodIssued: boolean
}

export function isCancelSettlement(value: unknown): value is CancelSettlement {
  return typeof value === 'string' && (CANCEL_SETTLEMENTS as readonly string[]).includes(value)
}

function readResult(value: unknown): CancelRecurrenceResult {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const ids = Array.isArray(record.creditMemoIds) ? record.creditMemoIds.filter((id): id is string => typeof id === 'string') : []
  return {
    status: typeof record.status === 'string' ? record.status : null,
    cancelEffectiveOn: typeof record.cancelEffectiveOn === 'string' ? record.cancelEffectiveOn : null,
    creditMemoIds: ids,
  }
}

export type RecurrenceCancelSupport = { registered: boolean; allowCredit: boolean }

function declaresCapability(handler: unknown, capability: string): boolean {
  if (!handler || typeof handler !== 'object') return false
  const capabilities = (handler as { capabilities?: unknown }).capabilities
  return Array.isArray(capabilities) && capabilities.includes(capability)
}

export async function recurrenceCancelSupport(): Promise<RecurrenceCancelSupport> {
  try {
    const handler = await commandRegistry.load(SALES_RECURRENCE_CANCEL_COMMAND)
    if (!handler) return { registered: false, allowCredit: false }
    return { registered: true, allowCredit: declaresCapability(handler, SALES_RECURRENCE_CANCEL_ALLOW_CREDIT_CAPABILITY) }
  } catch (err) {
    getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.recurrence_cancel_lookup_failed' })
    return { registered: false, allowCredit: false }
  }
}

export async function isRecurrenceCancelAvailable(): Promise<boolean> {
  const support = await recurrenceCancelSupport()
  return support.registered && support.allowCredit
}

export async function cancelRecurrence(
  container: AwilixContainer,
  scope: Scope,
  input: CancelRecurrenceInput,
): Promise<CancelRecurrenceResult> {
  const support = await recurrenceCancelSupport()
  if (!support.registered || (!input.allowCredit && !support.allowCredit)) {
    throw new SalesContractUnavailableError(SALES_RECURRENCE_CANCEL_COMMAND)
  }
  const commandBus = container.resolve('commandBus') as CommandBus
  const { result } = await commandBus.execute<Record<string, unknown>, unknown>(SALES_RECURRENCE_CANCEL_COMMAND, {
    input: {
      orderId: input.orderId,
      effectiveOn: input.effectiveOn,
      settlement: input.settlement,
      idempotencyKey: input.idempotencyKey,
      scheduleVersion: input.scheduleVersion ?? undefined,
      ...(support.allowCredit ? { allowCredit: input.allowCredit } : {}),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    ctx: buildTrustedSalesContext(container, scope),
  })
  return readResult(result)
}

function recurrenceReadOf(row: OrderRecurrenceRow, periods: RecurrencePeriod[], invoicesAvailable: boolean): RecurrenceRead {
  return {
    orderId: row.orderId,
    status: row.status,
    startsOn: row.startsOn,
    periodCount: row.periodCount,
    endsOn: row.endsOn,
    nextPeriodIndex: row.nextPeriodIndex,
    nextInvoiceOn: row.nextInvoiceOn,
    scheduleVersion: row.scheduleVersion,
    cancelEffectiveOn: row.cancelEffectiveOn,
    cancelSettlement: row.cancelSettlement,
    periods,
    invoicesAvailable,
  }
}

const UNDEFINED_TABLE = '42P01'

export function isMissingRelation(err: unknown): boolean {
  if (err instanceof TableNotFoundException) return true
  if (!err || typeof err !== 'object') return false
  const record = err as { code?: unknown; cause?: unknown }
  if (record.code === UNDEFINED_TABLE) return true
  return Boolean(record.cause && typeof record.cause === 'object' && (record.cause as { code?: unknown }).code === UNDEFINED_TABLE)
}

const UNDEFINED_COLUMN = '42703'

export function isMissingColumn(err: unknown): boolean {
  if (err instanceof InvalidFieldNameException) return true
  if (!err || typeof err !== 'object') return false
  const record = err as { code?: unknown; cause?: unknown }
  if (record.code === UNDEFINED_COLUMN) return true
  return Boolean(record.cause && typeof record.cause === 'object' && (record.cause as { code?: unknown }).code === UNDEFINED_COLUMN)
}

const PERIODS_SAVEPOINT = 'property_management_recurring_periods'

type OptionalPeriods<T> = { value: T; available: true } | { value: null; available: false }

async function readOptionalPeriods<T>(em: EntityManager, read: () => Promise<T>): Promise<OptionalPeriods<T>> {
  const transaction = em.getTransactionContext()
  const connection = em.getConnection()
  if (transaction) await connection.execute(`savepoint ${PERIODS_SAVEPOINT}`, [], 'run', transaction)
  let value: T
  try {
    value = await read()
  } catch (err) {
    if (transaction) await connection.execute(`rollback to savepoint ${PERIODS_SAVEPOINT}`, [], 'run', transaction)
    if (!isMissingRelation(err)) throw err
    return { value: null, available: false }
  }
  if (transaction) await connection.execute(`release savepoint ${PERIODS_SAVEPOINT}`, [], 'run', transaction)
  return { value, available: true }
}

export async function readRecurrence(em: EntityManager, scope: Scope, orderId: string): Promise<RecurrenceRead | null> {
  const row = await readOrderRecurrenceRow(em, scope, orderId)
  if (!row) return null
  const periods = await readOptionalPeriods(em, () => readRecurringPeriodRows(em, scope, orderId))
  return recurrenceReadOf(row, periods.value ?? [], periods.available)
}

export async function readRecurrences(em: EntityManager, scope: Scope, orderIds: readonly string[]): Promise<Map<string, RecurrenceRead>> {
  const rows = await readOrderRecurrenceRows(em, scope, orderIds)
  if (!rows.size) return new Map()
  const periods = await readOptionalPeriods(em, () => readRecurringPeriodRowsByOrder(em, scope, Array.from(rows.keys())))
  const periodsByOrder = periods.value ?? new Map<string, RecurrencePeriod[]>()
  const invoicesAvailable = periods.available
  const reads = new Map<string, RecurrenceRead>()
  for (const [orderId, row] of rows) reads.set(orderId, recurrenceReadOf(row, periodsByOrder.get(orderId) ?? [], invoicesAvailable))
  return reads
}

export function hasIssuedInvoice(recurrence: RecurrenceRead | null): boolean {
  if (!recurrence) return false
  if (recurrence.nextPeriodIndex > 0) return true
  return recurrence.periods.some((period) => Boolean(period.invoiceId))
}

export function issuedPeriods(recurrence: RecurrenceRead | null): RecurrencePeriod[] {
  if (!recurrence) return []
  return recurrence.periods.filter((period) => Boolean(period.invoiceId) && !period.creditMemoId)
}

export function previewCancelCredit(
  recurrence: RecurrenceRead | null,
  effectiveOn: string,
  settlement: CancelSettlement,
): CreditPreview {
  const issued = issuedPeriods(recurrence)
  const fullyCreditedPeriods = issued
    .filter((period) => compareIsoDates(period.periodStart, effectiveOn) >= 0)
    .map((period) => period.periodIndex)
  const final = issued.find(
    (period) => compareIsoDates(period.periodStart, effectiveOn) < 0 && compareIsoDates(period.periodEnd, effectiveOn) >= 0,
  )
  const finalCredits = Boolean(final) && settlement !== 'keep'
  return {
    wouldCredit: fullyCreditedPeriods.length > 0 || finalCredits,
    fullyCreditedPeriods,
    finalPeriodIndex: final?.periodIndex ?? null,
    finalPeriodIssued: Boolean(final),
  }
}

export async function defaultCancelSettlement(em: EntityManager, scope: Scope): Promise<CancelSettlement> {
  let rows: Array<{ recurring_cancel_settlement: unknown }>
  try {
    rows = await em.fork().getConnection().execute<Array<{ recurring_cancel_settlement: unknown }>>(
      `select recurring_cancel_settlement from sales_settings
        where organization_id = ? and tenant_id = ? and deleted_at is null limit 1`,
      [scope.organizationId, scope.tenantId],
    )
  } catch (err) {
    if (isMissingColumn(err)) return FALLBACK_CANCEL_SETTLEMENT
    throw err
  }
  const value = rows[0]?.recurring_cancel_settlement
  return isCancelSettlement(value) ? value : FALLBACK_CANCEL_SETTLEMENT
}
