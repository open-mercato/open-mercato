import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LeaseProposal } from '../data/entities'
import { leaseProposalIdSchema, type LeaseProposalIdInput } from '../data/validators'
import { conflictError, notFoundError } from '../lib/errors'
import { OPEN_PROPOSAL_STATUSES } from '../lib/leaseOccupancy'
import { closeProposal, loadPermittedLease, lockLeaseRow } from '../lib/leaseRecords'
import { isProposalExpired } from '../lib/leaseProposalLifecycle'
import { localToday } from '../lib/leaseTerm'
import { emitProposalEvent, leaseCrudEvents, leaseCrudIndexer } from '../lib/leaseEvents'
import { enqueueSalesOperations } from '../lib/salesOperations'
import type { PermittedBuildings } from '../lib/buildingAccess'
import type { Scope } from '../lib/productUse'
import { enforceLeaseLock, LEASE_RESOURCE_KIND } from './lease'
import { buildCrudLog, emitSideEffects, ensureScope, resolveEm, resolvePermitted } from './shared'

export type ProposalCloseResult = { proposalId: string; leaseId: string; status: string; changed: boolean }

async function loadProposal(ctx: CommandRuntimeContext, scope: Scope, input: LeaseProposalIdInput, permitted: PermittedBuildings) {
  const em = resolveEm(ctx)
  const proposal = await findOneWithDecryption(em, LeaseProposal, { id: input.id, ...scope }, undefined, scope)
  if (!proposal || (input.leaseId && proposal.leaseId !== input.leaseId)) {
    throw await notFoundError('property_management.errors.proposalNotFound', 'Proposal not found.')
  }
  await loadPermittedLease(em, scope, permitted, proposal.leaseId)
  return { em, proposal }
}

async function closeOpenProposal(
  input: LeaseProposalIdInput,
  ctx: CommandRuntimeContext,
  status: 'withdrawn' | 'expired',
  permitted: PermittedBuildings,
): Promise<ProposalCloseResult> {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const { em, proposal: current } = await loadProposal(ctx, scope, input, permitted)
  const today = localToday()
  const outcome = await em.fork().transactional(async (trx) => {
    const lease = await lockLeaseRow(trx, scope, current.leaseId)
    if (status === 'withdrawn') await enforceLeaseLock(ctx, lease)
    const proposal = await findOneWithDecryption(trx, LeaseProposal, { id: current.id, ...scope }, { refresh: true }, scope)
    if (!proposal || !(OPEN_PROPOSAL_STATUSES as readonly string[]).includes(proposal.status)) {
      if (status === 'expired') return { lease, proposal, op: null, changed: false }
      throw await conflictError('property_management.errors.proposalNotOpen', 'This proposal is no longer open.', { code: 'proposal_not_open' })
    }
    if (status === 'expired' && (proposal.status === 'sending' || !isProposalExpired(proposal.respondBy, today))) {
      return { lease, proposal, op: null, changed: false }
    }
    const op = await closeProposal(trx, scope, lease, proposal, status)
    await trx.flush()
    return { lease, proposal, op, changed: true }
  })
  if (outcome.op) await enqueueSalesOperations([outcome.op.id])
  if (outcome.changed && outcome.proposal) {
    await emitProposalEvent(
      status === 'expired' ? 'property_management.lease_proposal.expired' : 'property_management.lease_proposal.withdrawn',
      outcome.proposal,
    )
    await emitSideEffects(ctx, 'updated', outcome.lease, { indexer: leaseCrudIndexer, events: leaseCrudEvents })
  }
  return {
    proposalId: current.id,
    leaseId: current.leaseId,
    status: outcome.proposal?.status ?? current.status,
    changed: outcome.changed,
  }
}

const withdrawCommand: CommandHandler<LeaseProposalIdInput, ProposalCloseResult> = {
  id: 'property_management.lease_proposal.withdraw',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = leaseProposalIdSchema.parse(rawInput ?? {})
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    ensureScope(ctx, scope)
    return closeOpenProposal(input, ctx, 'withdrawn', await resolvePermitted(ctx, scope))
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.leaseId ?? null, 'property_management.audit.leaseProposal.withdraw', 'Withdraw lease proposal', LEASE_RESOURCE_KIND),
}

const expireCommand: CommandHandler<LeaseProposalIdInput, ProposalCloseResult> = {
  id: 'property_management.lease_proposal.expire',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = leaseProposalIdSchema.parse(rawInput ?? {})
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    ensureScope(ctx, scope)
    return closeOpenProposal(input, ctx, 'expired', await resolvePermitted(ctx, scope))
  },
}

registerCommand(withdrawCommand)
registerCommand(expireCommand)
