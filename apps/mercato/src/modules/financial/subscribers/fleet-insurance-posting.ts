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
  event: 'fleet_operations.insurance_policy.recorded',
  persistent: true,
  id: 'financial:fleet-insurance-posting',
}

type ResolverContainer = { resolve: <T = unknown>(name: string) => T }
type InsuranceRecordedPayload = {
  id?: string
  tenantId?: string
  organizationId?: string
  vehicleId?: string
  premiumAmount?: string
  currencyCode?: string
  startDate?: string
}

type SubscriberContext = ResolverContainer & {
  container?: ResolverContainer
  tenantId?: string | null
  organizationId?: string | null
}

function recordOf(value: unknown): InsuranceRecordedPayload {
  return value && typeof value === 'object' ? value as InsuranceRecordedPayload : {}
}

export default async function handle(payload: unknown, context: SubscriberContext): Promise<void> {
  const event = recordOf(payload)
  const policyId = event.id
  const tenantId = event.tenantId ?? context.tenantId ?? null
  const organizationId = event.organizationId ?? context.organizationId ?? null
  if (!policyId || !tenantId || !organizationId) return
  const premium = roundDecimalHalfUp(event.premiumAmount ?? '0', 2)
  if (isZeroDecimal(premium)) return

  const container = context.container ?? { resolve: context.resolve }
  const em = container.resolve<EntityManager>('em').fork()
  const scope = { tenantId, organizationId }

  try {
    const existing = await em.findOne(GlJournalEntry, {
      ...scope,
      sourceEntityType: 'fleet_insurance_policy',
      sourceEntityId: policyId,
      status: { $ne: 'reversed' },
    })
    if (existing) return

    const accounts = await em.find(GlAccount, { ...scope, deletedAt: null })
    const insuranceExpense = accounts.find((account) => account.code === '5700')
      ?? accounts.find((account) => account.accountType === 'operating_expense')
    const payable = accounts.find((account) => account.accountType === 'payable')
    if (!insuranceExpense || !payable) {
      logger.error('financial.fleet_insurance_posting.missing_accounts', { policyId })
      return
    }

    const description = 'Vehicle insurance premium'
    const lines: PostingSource['lines'] = [
      {
        accountId: insuranceExpense.id,
        debitAmount: premium,
        creditAmount: '0',
        description,
        taxCode: null,
      },
      {
        accountId: payable.id,
        debitAmount: '0',
        creditAmount: premium,
        description: `${description} — payable`,
        taxCode: null,
      },
    ]
    const source: PostingSource = {
      kind: 'fleet_insurance_policy',
      currencyCode: (event.currencyCode ?? 'SAR').toUpperCase(),
      postingDate: new Date(`${(event.startDate ?? new Date().toISOString()).slice(0, 10)}T00:00:00.000Z`),
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
      return createPostedEntry(trx, scope, source, 'fleet_insurance_policy', policyId, null, now)
    })
    await emitEntrySideEffects(commandCtx, scope, null, 'posted', entry)
  } catch (err) {
    logger.error('financial.fleet_insurance_posting.failed', { err, policyId })
    if (isCrudHttpError(err) && err.status < 500) return
    throw err
  }
}
