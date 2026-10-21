import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { GlAccount, GlJournalEntry } from '../data/entities'
import { isZeroDecimal, roundDecimalHalfUp, subtractDecimalStrings } from '../lib/money'
import { createPostedEntry, emitEntrySideEffects, type PostingSource } from '../commands/posting'

const logger = createLogger('financial')

export const metadata = {
  event: 'hr_management.payroll_run.closed',
  persistent: true,
  id: 'financial:hr-payroll-posting',
}

type ResolverContainer = { resolve: <T = unknown>(name: string) => T }
type PayrollClosedPayload = {
  id?: string
  periodStart?: string
  periodEnd?: string
  paymentDate?: string
  currencyCode?: string
  grossTotal?: string
  deductionTotal?: string
  netTotal?: string
  tenantId?: string
  organizationId?: string
}

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

function recordOf(value: unknown): PayrollClosedPayload {
  return value && typeof value === 'object' ? value as PayrollClosedPayload : {}
}

/**
 * Posts a closed payroll run to the ledger:
 *
 *   debit payroll expense (gross)
 *   credit net payable (net)
 *   credit payroll deductions payable (deductions)
 *
 * The net credit is derived as gross minus deductions so the entry balances even
 * if the event's stored totals disagree; the deduction liability is the account a
 * tenant uses to remit loan/penalty deductions. Idempotency is inherited from the
 * posting table's source index.
 */
export default async function handle(payload: unknown, context: SubscriberContext): Promise<void> {
  const event = recordOf(payload)
  const runId = event.id
  const tenantId = event.tenantId ?? context.tenantId ?? null
  const organizationId = event.organizationId ?? context.organizationId ?? null
  if (!runId || !tenantId || !organizationId) return
  const container = context.container ?? { resolve: context.resolve }
  const em = container.resolve<EntityManager>('em').fork()
  const scope = { tenantId, organizationId }

  try {
    const existing = await em.findOne(GlJournalEntry, {
      ...scope,
      sourceEntityType: 'hr_payroll_run',
      sourceEntityId: runId,
      status: { $ne: 'reversed' },
    })
    if (existing) return

    const accounts = await em.find(GlAccount, { ...scope, deletedAt: null })
    const payrollExpense = accounts.find((account) => account.accountType === 'payroll')
    const payable = accounts.find((account) => account.accountType === 'payable')
    const deductionsPayable = accounts.find((account) => account.code === '2160') ?? payable
    if (!payrollExpense || !payable) {
      logger.error('financial.hr_payroll_posting.missing_accounts', { runId })
      return
    }

    const gross = roundDecimalHalfUp(event.grossTotal ?? '0', 2)
    const deductions = roundDecimalHalfUp(event.deductionTotal ?? '0', 2)
    const net = roundDecimalHalfUp(subtractDecimalStrings(gross, deductions), 2)
    if (isZeroDecimal(gross)) return

    const lines: PostingSource['lines'] = [
      {
        accountId: payrollExpense.id,
        debitAmount: gross,
        creditAmount: '0',
        description: `Payroll ${event.periodStart ?? ''} – ${event.periodEnd ?? ''}`,
        taxCode: null,
      },
      {
        accountId: payable.id,
        debitAmount: '0',
        creditAmount: net,
        description: 'Payroll net payable',
        taxCode: null,
      },
    ]
    if (!isZeroDecimal(deductions)) {
      lines.push({
        accountId: deductionsPayable?.id ?? payable.id,
        debitAmount: '0',
        creditAmount: deductions,
        description: 'Payroll deductions payable',
        taxCode: null,
      })
    }

    const source: PostingSource = {
      kind: 'payroll_run',
      currencyCode: (event.currencyCode ?? 'SAR').toUpperCase(),
      postingDate: new Date(`${event.paymentDate ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
      description: `Payroll ${event.periodStart ?? ''} – ${event.periodEnd ?? ''}`,
      lines,
    }
    const commandCtx: CommandRuntimeContext = {
      container: container as unknown as AwilixContainer,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    }
    const entry = await em.transactional(async (trx) => {
      const now = new Date()
      return createPostedEntry(trx, scope, source, 'hr_payroll_run', runId, null, now)
    })
    await emitEntrySideEffects(commandCtx, scope, null, 'posted', entry)
  } catch (err) {
    logger.error('financial.hr_payroll_posting.failed', { err, runId })
    if (isCrudHttpError(err) && err.status < 500) return
    throw err
  }
}
