import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LeaseProposal, LeaseVersion, type SalesOperation } from '../data/entities'
import { leaseExtensionSchema, type LeaseExtensionInput } from '../data/validators'
import { conflictError, unprocessableError } from '../lib/errors'
import { compareIsoDates, extensionAnchorDay, extensionStartsOn, leaseEndsOn, localToday, respondByDate } from '../lib/leaseTerm'
import {
  buildLeaseOrderPayload,
  buildLeaseQuotePayload,
  findOpenProposals,
  leaseProductOf,
  loadPermittedLease,
  lockLeaseRow,
  lockUnitRow,
  nextVersionNo,
} from '../lib/leaseRecords'
import { enqueueSalesOperations, recordOperation } from '../lib/salesOperations'
import { resolveOrderStatusEntryId } from '../lib/salesLookups'
import { loadSettings } from '../lib/settings'
import { leaseCrudEvents, leaseCrudIndexer } from '../lib/leaseEvents'
import type { Scope } from '../lib/productUse'
import { assertNoBookingsInTerm, assertNoOverlap, assertUnitAvailableForTerm, enforceLeaseLock, LEASE_RESOURCE_KIND } from './lease'
import { buildCrudLog, emitSideEffects, ensureScope, lockBuilding, resolveEm, resolvePermitted } from './shared'

export type LeaseExtensionResult = {
  leaseId: string
  versionId: string
  proposalId: string | null
  status: 'pending' | 'sending'
  operationId: string
}

async function assertExtendable(
  em: EntityManager,
  scope: Scope,
  lease: { id: string; status: string; endsOn: string; pendingChange?: unknown },
): Promise<void> {
  if (lease.status !== 'active') {
    throw await conflictError('property_management.errors.leaseNotActive', 'Only an active lease can be extended.', { code: 'lease_not_active' })
  }
  if (compareIsoDates(lease.endsOn, localToday()) < 0) {
    throw await conflictError('property_management.errors.leaseAlreadyEnded', 'This lease has already ended.', { code: 'lease_already_ended' })
  }
  if (lease.pendingChange) {
    throw await conflictError('property_management.errors.leaseChangePending', 'A billing update of this lease is still pending. Try again once it has settled.', {
      code: 'lease_change_pending',
    })
  }
  const pendingExtensions = await findWithDecryption(
    em,
    LeaseVersion,
    { ...scope, leaseId: lease.id, state: 'pending', holdToken: { $ne: null } },
    { refresh: true },
    scope,
  )
  if (pendingExtensions.length) {
    throw await conflictError('property_management.errors.leaseChangePending', 'A billing update of this lease is still pending. Try again once it has settled.', {
      code: 'lease_change_pending',
    })
  }
  if ((await findOpenProposals(em, scope, lease.id)).length) {
    throw await conflictError('property_management.errors.leaseProposalOpen', 'This lease already has an open proposal. Withdraw it first.', {
      code: 'lease_proposal_open',
    })
  }
}

async function extendLease(input: LeaseExtensionInput, ctx: CommandRuntimeContext): Promise<LeaseExtensionResult> {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  ensureScope(ctx, scope)
  const em = resolveEm(ctx)
  const permitted = await resolvePermitted(ctx, scope)
  const current = await loadPermittedLease(em, scope, permitted, input.id)
  await enforceLeaseLock(ctx, current)
  await assertExtendable(em, scope, current)
  const settings = await loadSettings(em, scope)
  if (!settings.billingChannelId) {
    throw await unprocessableError('property_management.errors.billingChannelMissing', 'Choose the sales channel for lease documents in Property Management settings first.', {
      code: 'billing_channel_missing',
    })
  }
  const currentVersion = current.currentVersionId
    ? await findOneWithDecryption(em, LeaseVersion, { id: current.currentVersionId, ...scope }, undefined, scope)
    : null
  if (!currentVersion) {
    throw await conflictError('property_management.errors.leaseNotActive', 'Only an active lease can be extended.', { code: 'lease_not_active' })
  }
  const startsOn = extensionStartsOn(current.endsOn)
  const anchorDay = extensionAnchorDay(current.startsOn, startsOn)
  const endsOn = leaseEndsOn(startsOn, input.months, anchorDay)
  const expiresInDays = input.expiresInDays ?? settings.proposalExpiryDays
  const respondBy = respondByDate(expiresInDays)
  if (input.asProposal && compareIsoDates(startsOn, respondBy) < 0) {
    throw await unprocessableError('property_management.errors.proposalStartsBeforeRespondBy', 'A proposed lease must start on or after its respond-by date.', {
      code: 'proposal_starts_before_respond_by',
      respondBy,
      fieldErrors: { expiresInDays: 'property_management.errors.proposalStartsBeforeRespondBy' },
    })
  }
  const sentStatusEntryId = input.asProposal ? await resolveOrderStatusEntryId(em.fork(), scope, 'sent') : null
  const product = leaseProductOf(currentVersion)
  const token = randomUUID()
  const outcome = await em.fork().transactional(async (trx) => {
    await lockBuilding(trx, scope, current.buildingId)
    const lease = await lockLeaseRow(trx, scope, current.id)
    await enforceLeaseLock(ctx, lease)
    await assertExtendable(trx, scope, lease)
    if (lease.endsOn !== current.endsOn) {
      throw await conflictError('property_management.errors.leaseChangedMeanwhile', 'The lease changed meanwhile. Reload and try again.', { code: 'lease_changed' })
    }
    const unit = await lockUnitRow(trx, scope, lease.unitId)
    await assertUnitAvailableForTerm(trx, scope, unit, { startsOn, endsOn })
    await assertNoOverlap(trx, scope, lease.unitId, { startsOn, endsOn }, lease.id)
    await assertNoBookingsInTerm(trx, scope, lease.unitId, { startsOn, endsOn })
    const version = trx.create(LeaseVersion, {
      id: randomUUID(),
      ...scope,
      leaseId: lease.id,
      versionNo: await nextVersionNo(trx, scope, lease.id),
      event: 'extended',
      state: 'pending',
      catalogProductId: product.catalogProductId,
      productName: product.productName,
      monthlyRate: input.monthlyRate,
      currencyCode: product.currencyCode,
      startsOn,
      endsOn,
      months: input.months,
      holdToken: input.asProposal ? null : token,
      effectiveFrom: startsOn,
    })
    trx.persist(version)
    const documentInput = {
      lease,
      product,
      channelId: settings.billingChannelId as string,
      startsOn,
      months: input.months,
      monthlyRate: input.monthlyRate,
      anchorDay,
      versionId: version.id,
    }
    let proposal: LeaseProposal | null = null
    let operation: SalesOperation
    if (input.asProposal) {
      proposal = trx.create(LeaseProposal, {
        id: randomUUID(),
        ...scope,
        leaseId: lease.id,
        versionId: version.id,
        kind: 'extension',
        startsOn,
        endsOn,
        months: input.months,
        monthlyRate: input.monthlyRate,
        currencyCode: product.currencyCode,
        message: input.message ?? null,
        expiresInDays,
        respondBy,
        status: 'sending',
        holdToken: token,
      })
      trx.persist(proposal)
      operation = await recordOperation(trx, scope, {
        kind: 'quote',
        subjectKey: `quote:${proposal.id}`,
        payload: buildLeaseQuotePayload({ ...documentInput, respondBy, sentStatusEntryId }),
        targetType: 'lease_proposal',
        targetId: proposal.id,
        leaseId: lease.id,
        token,
      })
    } else {
      operation = await recordOperation(trx, scope, {
        kind: 'extension_order',
        subjectKey: `extension_order:${version.id}`,
        payload: buildLeaseOrderPayload(documentInput),
        targetType: 'lease_version',
        targetId: version.id,
        leaseId: lease.id,
        token,
      })
    }
    lease.updatedAt = new Date()
    await trx.flush()
    return { lease, version, proposal, operation }
  })
  await enqueueSalesOperations([outcome.operation.id])
  await emitSideEffects(ctx, 'updated', outcome.lease, { indexer: leaseCrudIndexer, events: leaseCrudEvents })
  return {
    leaseId: outcome.lease.id,
    versionId: outcome.version.id,
    proposalId: outcome.proposal?.id ?? null,
    status: input.asProposal ? 'sending' : 'pending',
    operationId: outcome.operation.id,
  }
}

function extensionCommand(id: string, asProposal: boolean): CommandHandler<LeaseExtensionInput, LeaseExtensionResult> {
  return {
    id,
    isUndoable: false,
    async execute(rawInput, ctx) {
      return extendLease(leaseExtensionSchema.parse({ ...(rawInput ?? {}), asProposal }), ctx)
    },
    buildLog: async ({ input, result, ctx }) =>
      buildCrudLog(
        ctx,
        input,
        result?.leaseId ?? null,
        asProposal ? 'property_management.audit.lease.proposeExtension' : 'property_management.audit.lease.extend',
        asProposal ? 'Propose lease extension' : 'Extend lease',
        LEASE_RESOURCE_KIND,
      ),
  }
}

registerCommand(extensionCommand('property_management.lease.extend', false))
registerCommand(extensionCommand('property_management.lease.propose_extension', true))
