import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { Lease, LeaseProposal, SalesOperation } from '../data/entities'
import { buildTrustedSalesContext } from './salesCommandContext'
import { compareIsoDates, localToday } from './leaseTerm'
import { isProposalExpired, isReminderDue } from './leaseProposalLifecycle'
import { lockLeaseRow } from './leaseRecords'
import { emitLeaseEvent, markLeaseChanged } from './leaseEvents'
import { enqueueSalesOperations, type OperationEnqueuer } from './salesOperations'
import type { Scope } from './productUse'

const logger = createLogger('property_management')

export { LEASE_SWEEP_QUEUE } from './queues'
const SWEEP_BATCH = 500

export type LeaseSweepSummary = {
  ended: number
  expired: number
  reminded: number
  reenqueued: number
}

export type LeaseSweepDeps = {
  container: AwilixContainer
  em: EntityManager
  today?: string
  enqueuer?: OperationEnqueuer
}

async function endLeasesPastTerm(deps: LeaseSweepDeps, scope: Scope, today: string): Promise<number> {
  const candidates = await findWithDecryption(
    deps.em.fork(),
    Lease,
    { ...scope, status: 'active', pendingChange: null, deletedAt: null, endsOn: { $lt: today } },
    { limit: SWEEP_BATCH, orderBy: { endsOn: 'asc' } },
    scope,
  )
  let ended = 0
  for (const candidate of candidates) {
    try {
      const lease = await deps.em.fork().transactional(async (trx) => {
        const locked = await lockLeaseRow(trx, scope, candidate.id)
        if (locked.status !== 'active' || locked.pendingChange || compareIsoDates(locked.endsOn, today) >= 0) return null
        locked.status = 'ended'
        locked.updatedAt = new Date()
        await trx.flush()
        return locked
      })
      if (!lease) continue
      ended += 1
      await markLeaseChanged(deps.container, lease, 'updated')
      await emitLeaseEvent('property_management.lease.ended', lease)
    } catch (err) {
      logger.error('Ending a lease past its term failed', { leaseId: candidate.id, err })
    }
  }
  return ended
}

async function runProposalCommands(deps: LeaseSweepDeps, scope: Scope, today: string): Promise<{ expired: number; reminded: number }> {
  const proposals = await findWithDecryption(
    deps.em.fork(),
    LeaseProposal,
    { ...scope, status: { $in: ['sent', 'declined'] } },
    { limit: SWEEP_BATCH, orderBy: { respondBy: 'asc' } },
    scope,
  )
  const commandBus = deps.container.resolve('commandBus') as CommandBus
  const ctx = buildTrustedSalesContext(deps.container, scope)
  let expired = 0
  let reminded = 0
  for (const proposal of proposals) {
    const input = { id: proposal.id, ...scope }
    try {
      if (isProposalExpired(proposal.respondBy, today)) {
        const { result } = await commandBus.execute<typeof input, { changed: boolean }>('property_management.lease_proposal.expire', { input, ctx })
        if (result?.changed) expired += 1
        continue
      }
      if (proposal.status === 'sent' && !proposal.remindedAt && isReminderDue(proposal.respondBy, today)) {
        const { result } = await commandBus.execute<typeof input, { reminded: boolean }>('property_management.lease_proposal.remind', { input, ctx })
        if (result?.reminded) reminded += 1
      }
    } catch (err) {
      logger.error('Lease proposal sweep step failed', { proposalId: proposal.id, err })
    }
  }
  return { expired, reminded }
}

export async function reenqueueOpenOperations(deps: LeaseSweepDeps, scope: Scope): Promise<number> {
  const ids = await deps.em.fork().transactional(async (trx) => {
    const rows = await findWithDecryption(
      trx,
      SalesOperation,
      { ...scope, status: { $in: ['pending', 'compensating'] } },
      { lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE, limit: SWEEP_BATCH, orderBy: { createdAt: 'asc' } },
      scope,
    )
    return rows.map((row) => row.id)
  })
  await (deps.enqueuer ?? enqueueSalesOperations)(ids)
  return ids.length
}

export async function runLeaseSweep(deps: LeaseSweepDeps, scope: Scope): Promise<LeaseSweepSummary> {
  const today = deps.today ?? localToday()
  const ended = await endLeasesPastTerm(deps, scope, today)
  const { expired, reminded } = await runProposalCommands(deps, scope, today)
  const reenqueued = await reenqueueOpenOperations(deps, scope)
  return { ended, expired, reminded, reenqueued }
}

export async function listSweepScopes(em: EntityManager): Promise<Scope[]> {
  const rows = await em.getConnection().execute<Array<{ organization_id: string; tenant_id: string }>>(
    `select distinct organization_id, tenant_id from property_management_leases
     union
     select distinct organization_id, tenant_id from property_management_sales_operations`,
    [],
  )
  return rows.map((row) => ({ organizationId: String(row.organization_id), tenantId: String(row.tenant_id) }))
}
