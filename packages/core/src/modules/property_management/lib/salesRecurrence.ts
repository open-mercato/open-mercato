import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { commandRegistry, type CommandBus } from '@open-mercato/shared/lib/commands'
import { buildTrustedSalesContext } from './salesCommandContext'
import { SalesContractUnavailableError } from './salesErrors'
import { readOrderRecurrenceRow, readRecurringPeriodRows, type RecurringPeriodRow } from './salesLookups'
import { compareIsoDates } from './leaseTerm'
import type { Scope } from './productUse'

export const SALES_RECURRENCE_CANCEL_COMMAND = 'sales.orders.recurrence.cancel'
export const CANCEL_SETTLEMENTS = ['prorate', 'credit_full', 'keep'] as const
export type CancelSettlement = (typeof CANCEL_SETTLEMENTS)[number]
export const FALLBACK_CANCEL_SETTLEMENT: CancelSettlement = 'prorate'

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

export async function isRecurrenceCancelAvailable(): Promise<boolean> {
  try {
    return (await commandRegistry.load(SALES_RECURRENCE_CANCEL_COMMAND)) !== null
  } catch {
    return false
  }
}

export async function cancelRecurrence(
  container: AwilixContainer,
  scope: Scope,
  input: CancelRecurrenceInput,
): Promise<CancelRecurrenceResult> {
  if (!(await isRecurrenceCancelAvailable())) {
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
      allowCredit: input.allowCredit,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    ctx: buildTrustedSalesContext(container, scope),
  })
  return readResult(result)
}

export async function readRecurrence(em: EntityManager, scope: Scope, orderId: string): Promise<RecurrenceRead | null> {
  const row = await readOrderRecurrenceRow(em, scope, orderId)
  if (!row) return null
  let periods: RecurrencePeriod[] = []
  let invoicesAvailable = true
  try {
    periods = await readRecurringPeriodRows(em, scope, orderId)
  } catch {
    invoicesAvailable = false
  }
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

let settlementColumnPresent: boolean | null = null

async function settlementColumnExists(em: EntityManager): Promise<boolean> {
  if (settlementColumnPresent !== null) return settlementColumnPresent
  try {
    const rows = await em.fork().getConnection().execute<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
        where table_name = 'sales_settings' and column_name = 'recurring_cancel_settlement' limit 1`,
      [],
    )
    settlementColumnPresent = rows.length > 0
  } catch {
    return false
  }
  return settlementColumnPresent
}

export async function defaultCancelSettlement(em: EntityManager, scope: Scope): Promise<CancelSettlement> {
  if (!(await settlementColumnExists(em))) return FALLBACK_CANCEL_SETTLEMENT
  try {
    const rows = await em.fork().getConnection().execute<Array<{ recurring_cancel_settlement: unknown }>>(
      `select recurring_cancel_settlement from sales_settings
        where organization_id = ? and tenant_id = ? and deleted_at is null limit 1`,
      [scope.organizationId, scope.tenantId],
    )
    const value = rows[0]?.recurring_cancel_settlement
    return isCancelSettlement(value) ? value : FALLBACK_CANCEL_SETTLEMENT
  } catch {
    return FALLBACK_CANCEL_SETTLEMENT
  }
}

export function resetSalesRecurrenceAdapterCache(): void {
  settlementColumnPresent = null
}
