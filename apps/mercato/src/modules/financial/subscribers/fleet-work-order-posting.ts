import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { GlAccount, GlJournalEntry } from '../data/entities'
import { isZeroDecimal, roundDecimalHalfUp } from '../lib/money'
import { createPostedEntry, emitEntrySideEffects, type PostingSource } from '../commands/posting'

const logger = createLogger('financial')

export const metadata = {
  event: 'fleet_operations.work_order.completed',
  persistent: true,
  id: 'financial:fleet-work-order-posting',
}

type ResolverContainer = { resolve: <T = unknown>(name: string) => T }
type WorkOrderCompletedPayload = {
  id?: string
  tenantId?: string
  organizationId?: string
  vehicleId?: string
  workOrderNumber?: string
  totalCost?: string
  currencyCode?: string
  completedAt?: string
}

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

function recordOf(value: unknown): WorkOrderCompletedPayload {
  return value && typeof value === 'object' ? value as WorkOrderCompletedPayload : {}
}

export default async function handle(payload: unknown, context: SubscriberContext): Promise<void> {
  const event = recordOf(payload)
  const workOrderId = event.id
  const tenantId = event.tenantId ?? context.tenantId ?? null
  const organizationId = event.organizationId ?? context.organizationId ?? null
  if (!workOrderId || !tenantId || !organizationId) return
  const totalCost = roundDecimalHalfUp(event.totalCost ?? '0', 2)
  if (isZeroDecimal(totalCost)) return

  const container = context.container ?? { resolve: context.resolve }
  const em = container.resolve<EntityManager>('em').fork()
  const scope = { tenantId, organizationId }

  try {
    const existing = await em.findOne(GlJournalEntry, {
      ...scope,
      sourceEntityType: 'fleet_work_order',
      sourceEntityId: workOrderId,
      status: { $ne: 'reversed' },
    })
    if (existing) return

    const accounts = await em.find(GlAccount, { ...scope, deletedAt: null })
    const maintenanceExpense = accounts.find((account) => account.code === '5600')
      ?? accounts.find((account) => account.accountType === 'operating_expense')
    const payable = accounts.find((account) => account.accountType === 'payable')
    if (!maintenanceExpense || !payable) {
      logger.error('financial.fleet_work_order_posting.missing_accounts', { workOrderId })
      return
    }

    const description = `Work order ${event.workOrderNumber ?? workOrderId.slice(0, 8)}`
    const lines: PostingSource['lines'] = [
      {
        accountId: maintenanceExpense.id,
        debitAmount: totalCost,
        creditAmount: '0',
        description,
        taxCode: null,
      },
      {
        accountId: payable.id,
        debitAmount: '0',
        creditAmount: totalCost,
        description: `${description} — payable`,
        taxCode: null,
      },
    ]
    const source: PostingSource = {
      kind: 'fleet_work_order',
      currencyCode: (event.currencyCode ?? 'SAR').toUpperCase(),
      postingDate: new Date(`${(event.completedAt ?? new Date().toISOString()).slice(0, 10)}T00:00:00.000Z`),
      description,
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
      return createPostedEntry(trx, scope, source, 'fleet_work_order', workOrderId, null, now)
    })
    await emitEntrySideEffects(commandCtx, scope, null, 'posted', entry)
  } catch (err) {
    logger.error('financial.fleet_work_order_posting.failed', { err, workOrderId })
    if (isCrudHttpError(err) && err.status < 500) return
    throw err
  }
}
