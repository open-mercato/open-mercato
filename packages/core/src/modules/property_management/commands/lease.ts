import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Lease, LeaseProposal, LeaseVersion, type LeasePendingChange, type SalesOperation } from '../data/entities'
import {
  leaseCreateSchema,
  leaseEndSchema,
  leaseIdSchema,
  leaseUpdateSchema,
  type LeaseCreateInput,
  type LeaseEndInput,
  type LeaseIdInput,
  type LeaseUpdateInput,
} from '../data/validators'
import { conflictError, forbiddenError, unprocessableError } from '../lib/errors'
import { compareIsoDates, leaseEndsOn, localToday, respondByDate } from '../lib/leaseTerm'
import { findOverlaps, loadReservedRanges } from '../lib/leaseOccupancy'
import { issueLeaseReference } from '../lib/leaseReference'
import {
  buildLeaseOrderPayload,
  buildLeaseQuotePayload,
  closeProposal,
  findOpenProposals,
  loadPermittedLease,
  loadPermittedUnit,
  lockLeaseRow,
  lockUnitRow,
  resolveLeaseParty,
  resolveLeaseProduct,
} from '../lib/leaseRecords'
import { defaultRecurrenceReader, loadBilledVersions, planLeaseEnd } from '../lib/leaseEndPlan'
import { leaseCrudEvents, leaseCrudIndexer, emitLeaseEvent } from '../lib/leaseEvents'
import { hasCreditPermission } from '../lib/creditPermission'
import { defaultCancelSettlement, hasIssuedInvoice, readRecurrence } from '../lib/salesRecurrence'
import { enqueueSalesOperations, recordOperation } from '../lib/salesOperations'
import { resolveOrderStatusEntryId } from '../lib/salesLookups'
import { loadSettings } from '../lib/settings'
import type { Scope } from '../lib/productUse'
import { buildCrudLog, emitSideEffects, ensureScope, lockBuilding, resolveEm, resolvePermitted } from './shared'

export const LEASE_RESOURCE_KIND = 'property_management.lease'

export type LeaseCreateResult = {
  leaseId: string
  proposalId: string | null
  status: 'pending_order' | 'sending'
  operationId: string
}

export type LeaseChangeResult = { leaseId: string; changeId: string | null; pending: boolean }

type LeaseSnapshot = { id: string; tenantId: string; organizationId: string; primaryContactPersonId: string | null }

function scopeOfInput(input: { tenantId: string; organizationId: string }): Scope {
  return { tenantId: input.tenantId, organizationId: input.organizationId }
}

async function requireBillingChannel(em: EntityManager, scope: Scope): Promise<string> {
  const settings = await loadSettings(em, scope)
  if (!settings.billingChannelId) {
    throw await unprocessableError('property_management.errors.billingChannelMissing', 'Choose the sales channel for lease documents in Property Management settings first.', {
      code: 'billing_channel_missing',
    })
  }
  return settings.billingChannelId
}

async function assertBuildingOpen(em: EntityManager, scope: Scope, buildingId: string): Promise<void> {
  const building = await lockBuilding(em, scope, buildingId)
  if (building.status === 'archived') {
    throw await unprocessableError('property_management.errors.unitUnavailableForLease', 'The unit is not available for new leases.', {
      code: 'unit_unavailable',
    })
  }
}

export async function assertNoOverlap(
  em: EntityManager,
  scope: Scope,
  unitId: string,
  term: { startsOn: string; endsOn: string },
  excludeLeaseId?: string | null,
): Promise<void> {
  const ranges = await loadReservedRanges(em, scope, [unitId], { excludeLeaseId })
  const overlaps = findOverlaps(ranges, unitId, term)
  if (overlaps.length) {
    throw await conflictError('property_management.errors.leaseOverlap', 'Another lease or open proposal of this unit overlaps the term.', {
      code: 'lease_overlap',
      conflicts: overlaps.map((range) => ({ reference: range.reference, startsOn: range.startsOn, endsOn: range.endsOn, source: range.source })),
    })
  }
}

async function createLease(input: LeaseCreateInput, ctx: CommandRuntimeContext): Promise<LeaseCreateResult & { lease: Lease }> {
  const scope = scopeOfInput(input)
  ensureScope(ctx, scope)
  const em = resolveEm(ctx)
  const permitted = await resolvePermitted(ctx, scope)
  const channelId = await requireBillingChannel(em, scope)
  const unit = await loadPermittedUnit(em, scope, permitted, input.unitId)
  const party = await resolveLeaseParty(em, scope, input.customerCompanyId, input.primaryContactPersonId)
  const product = await resolveLeaseProduct(em, scope, unit)
  const endsOn = leaseEndsOn(input.startsOn, input.termMonths)
  const settings = await loadSettings(em, scope)
  const expiresInDays = input.expiresInDays ?? settings.proposalExpiryDays
  const respondBy = respondByDate(expiresInDays)
  if (input.asProposal && compareIsoDates(input.startsOn, respondBy) < 0) {
    throw await unprocessableError('property_management.errors.proposalStartsBeforeRespondBy', 'A proposed lease must start on or after its respond-by date.', {
      code: 'proposal_starts_before_respond_by',
      respondBy,
      fieldErrors: { startsOn: 'property_management.errors.proposalStartsBeforeRespondBy' },
    })
  }
  const sentStatusEntryId = input.asProposal ? await resolveOrderStatusEntryId(em.fork(), scope, 'sent') : null
  const token = randomUUID()
  const outcome = await em.fork().transactional(async (trx) => {
    await assertBuildingOpen(trx, scope, unit.buildingId)
    await lockUnitRow(trx, scope, unit.id)
    await assertNoOverlap(trx, scope, unit.id, { startsOn: input.startsOn, endsOn })
    const reference = await issueLeaseReference(trx, scope)
    const lease = trx.create(Lease, {
      id: randomUUID(),
      ...scope,
      reference,
      buildingId: unit.buildingId,
      unitId: unit.id,
      customerCompanyId: party.companyId,
      primaryContactPersonId: party.contactPersonId,
      status: input.asProposal ? 'proposed' : 'pending_order',
      startsOn: input.startsOn,
      termMonths: input.termMonths,
      endsOn,
      holdToken: input.asProposal ? null : token,
    })
    const version = trx.create(LeaseVersion, {
      id: randomUUID(),
      ...scope,
      leaseId: lease.id,
      versionNo: 1,
      event: 'activated',
      state: 'pending',
      catalogProductId: product.catalogProductId,
      productName: product.productName,
      monthlyRate: String(input.monthlyRate),
      currencyCode: product.currencyCode,
      startsOn: input.startsOn,
      endsOn,
      months: input.termMonths,
      holdToken: input.asProposal ? null : token,
      effectiveFrom: input.startsOn,
    })
    trx.persist(lease)
    trx.persist(version)
    const documentInput = {
      lease,
      product,
      channelId,
      startsOn: input.startsOn,
      months: input.termMonths,
      monthlyRate: input.monthlyRate,
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
        kind: 'new',
        startsOn: input.startsOn,
        endsOn,
        months: input.termMonths,
        monthlyRate: String(input.monthlyRate),
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
        kind: 'lease_order',
        subjectKey: `lease_order:${version.id}`,
        payload: buildLeaseOrderPayload(documentInput),
        targetType: 'lease_version',
        targetId: version.id,
        leaseId: lease.id,
        token,
      })
    }
    await trx.flush()
    return { lease, proposal, operation }
  })
  await enqueueSalesOperations([outcome.operation.id])
  await emitSideEffects(ctx, 'created', outcome.lease, { indexer: leaseCrudIndexer, events: leaseCrudEvents })
  return {
    lease: outcome.lease,
    leaseId: outcome.lease.id,
    proposalId: outcome.proposal?.id ?? null,
    status: input.asProposal ? 'sending' : 'pending_order',
    operationId: outcome.operation.id,
  }
}

function createCommand(id: string, asProposal: boolean): CommandHandler<LeaseCreateInput, LeaseCreateResult> {
  return {
    id,
    isUndoable: false,
    async execute(rawInput, ctx) {
      const parsed = leaseCreateSchema.parse({ ...(rawInput ?? {}), asProposal })
      const { lease: _lease, ...result } = await createLease(parsed, ctx)
      return result
    },
    buildLog: async ({ input, result, ctx }) =>
      buildCrudLog(
        ctx,
        input,
        result?.leaseId ?? null,
        asProposal ? 'property_management.audit.lease.propose' : 'property_management.audit.lease.create',
        asProposal ? 'Propose lease' : 'Create lease',
        LEASE_RESOURCE_KIND,
      ),
  }
}

function snapshotLease(lease: Lease): LeaseSnapshot {
  return {
    id: lease.id,
    tenantId: lease.tenantId,
    organizationId: lease.organizationId,
    primaryContactPersonId: lease.primaryContactPersonId ?? null,
  }
}

async function applyContact(ctx: CommandRuntimeContext, scope: Scope, leaseId: string, contactId: string | null): Promise<Lease> {
  const em = resolveEm(ctx)
  const permitted = await resolvePermitted(ctx, scope)
  const current = await loadPermittedLease(em, scope, permitted, leaseId)
  await enforceLeaseLock(ctx, current)
  const party = await resolveLeaseParty(em, scope, current.customerCompanyId, contactId)
  current.primaryContactPersonId = party.contactPersonId
  current.updatedAt = new Date()
  await em.flush()
  return current
}

const updateLeaseCommand: CommandHandler<LeaseUpdateInput, { leaseId: string }> = {
  id: 'property_management.lease.update',
  prepare: async (rawInput, ctx) => {
    const parsed = leaseUpdateSchema.parse(rawInput ?? {})
    const scope = scopeOfInput(parsed)
    const lease = await findOneWithDecryption(resolveEm(ctx), Lease, { id: parsed.id, ...scope }, undefined, scope)
    return lease ? { before: snapshotLease(lease) } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = leaseUpdateSchema.parse(rawInput ?? {})
    const scope = scopeOfInput(parsed)
    ensureScope(ctx, scope)
    if (parsed.primaryContactPersonId === undefined) return { leaseId: parsed.id }
    const lease = await applyContact(ctx, scope, parsed.id, parsed.primaryContactPersonId)
    await emitSideEffects(ctx, 'updated', lease, { indexer: leaseCrudIndexer, events: leaseCrudEvents })
    return { leaseId: lease.id }
  },
  buildLog: async ({ input, result, ctx, snapshots }) => {
    const base = await buildCrudLog(ctx, input, result?.leaseId ?? null, 'property_management.audit.lease.update', 'Update lease', LEASE_RESOURCE_KIND)
    const before = snapshots?.before as LeaseSnapshot | undefined
    return { ...base, snapshotBefore: before, payload: { undo: { before } } }
  },
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<{ before?: LeaseSnapshot }>(logEntry)?.before
    if (!before) return
    const scope = scopeOfInput(before)
    ensureScope(ctx, scope)
    const lease = await applyContact(ctx, scope, before.id, before.primaryContactPersonId)
    await emitSideEffects(ctx, 'updated', lease, { indexer: leaseCrudIndexer, events: leaseCrudEvents }, 'undo')
  },
}

function previousOf(lease: Lease): LeasePendingChange['previous'] {
  return {
    endsOn: lease.endsOn,
    startsOn: lease.startsOn,
    status: lease.status,
    termMonths: lease.termMonths,
    currentVersionId: lease.currentVersionId ?? null,
  }
}

export async function enforceLeaseLock(ctx: CommandRuntimeContext, lease: Lease): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind: LEASE_RESOURCE_KIND,
    resourceId: lease.id,
    current: lease.updatedAt,
    request: ctx.request ?? null,
  })
}

async function assertNoPendingChange(lease: Lease): Promise<void> {
  if (lease.pendingChange) {
    throw await conflictError('property_management.errors.leaseChangePending', 'A billing update of this lease is still pending. Try again once it has settled.', {
      code: 'lease_change_pending',
    })
  }
}

async function releasePendingExtensions(em: EntityManager, scope: Scope, leaseId: string): Promise<void> {
  const pending = await findWithDecryption(
    em,
    LeaseVersion,
    { ...scope, leaseId, state: 'pending', holdToken: { $ne: null } },
    { refresh: true },
    scope,
  )
  for (const version of pending) version.holdToken = null
}

async function endLease(input: LeaseEndInput, ctx: CommandRuntimeContext): Promise<LeaseChangeResult> {
  const scope = scopeOfInput(input)
  ensureScope(ctx, scope)
  const em = resolveEm(ctx)
  const permitted = await resolvePermitted(ctx, scope)
  const current = await loadPermittedLease(em, scope, permitted, input.id)
  await enforceLeaseLock(ctx, current)
  const today = localToday()
  if (current.status === 'ended') {
    throw await conflictError('property_management.errors.leaseAlreadyEnded', 'This lease has already ended.', { code: 'lease_already_ended' })
  }
  if (current.status !== 'active') {
    throw await conflictError('property_management.errors.leaseNotActive', 'Only an active lease can be ended.', { code: 'lease_not_active' })
  }
  await assertNoPendingChange(current)
  if (compareIsoDates(input.endsOn, current.endsOn) > 0) {
    throw await conflictError('property_management.errors.leaseEndLaterThanCurrent', 'The new end is later than the current end. Extend the lease instead.', {
      code: 'lease_end_later_than_current',
      endsOn: current.endsOn,
    })
  }
  if (compareIsoDates(input.endsOn, current.startsOn) < 0) {
    throw await unprocessableError('property_management.errors.leaseEndBeforeStart', 'A lease cannot end before it starts. Delete it instead.', {
      code: 'lease_end_before_start',
      fieldErrors: { endsOn: 'property_management.errors.leaseEndBeforeStart' },
    })
  }
  const settlement = input.settlement ?? (await defaultCancelSettlement(em, scope))
  const versions = await loadBilledVersions(em, scope, current.id)
  const plan = await planLeaseEnd(versions, input.endsOn, settlement, defaultRecurrenceReader(em, scope))
  const allowCredit = await hasCreditPermission(ctx.container, ctx.auth, scope)
  if (plan.wouldCredit && !allowCredit) {
    throw await forbiddenError('property_management.errors.creditPermissionRequired', 'Ending the lease this way credits an invoice, which needs the sales credit memo permission.', {
      code: 'credit_permission_required',
    })
  }
  const changeId = randomUUID()
  const outcome = await em.fork().transactional(async (trx) => {
    const lease = await lockLeaseRow(trx, scope, current.id)
    await assertNoPendingChange(lease)
    if (lease.status !== 'active' || lease.endsOn !== current.endsOn) {
      throw await conflictError('property_management.errors.leaseChangedMeanwhile', 'The lease changed meanwhile. Reload and try again.', { code: 'lease_changed' })
    }
    const statusOps: SalesOperation[] = []
    for (const proposal of await findOpenProposals(trx, scope, lease.id)) {
      if (proposal.kind !== 'extension') continue
      const op = await closeProposal(trx, scope, lease, proposal, 'withdrawn')
      if (op) statusOps.push(op)
    }
    await releasePendingExtensions(trx, scope, lease.id)
    const previous = previousOf(lease)
    const cancelOps: SalesOperation[] = []
    for (const [index, entry] of plan.entries.entries()) {
      cancelOps.push(
        await recordOperation(trx, scope, {
          kind: 'recurrence_cancel',
          subjectKey: `recurrence_cancel:${entry.orderId}:${changeId}`,
          payload: { orderId: entry.orderId, effectiveOn: entry.effectiveOn, settlement },
          targetType: 'lease',
          targetId: lease.id,
          leaseId: lease.id,
          changeId,
          sequence: index + 1,
          allowCredit,
        }),
      )
    }
    lease.endsOn = input.endsOn
    lease.lastBillingRefusal = null
    lease.updatedAt = new Date()
    if (cancelOps.length) {
      lease.pendingChange = { kind: 'end', changeId, previous, operationIds: cancelOps.map((op) => op.id) }
    } else if (compareIsoDates(lease.endsOn, today) < 0) {
      lease.status = 'ended'
    }
    await trx.flush()
    return { lease, statusOps, cancelOps }
  })
  const toEnqueue = [...outcome.statusOps.map((op) => op.id), ...outcome.cancelOps.slice(0, 1).map((op) => op.id)]
  await enqueueSalesOperations(toEnqueue)
  await emitSideEffects(ctx, 'updated', outcome.lease, { indexer: leaseCrudIndexer, events: leaseCrudEvents })
  if (outcome.lease.status === 'ended') await emitLeaseEvent('property_management.lease.ended', outcome.lease)
  return { leaseId: outcome.lease.id, changeId: outcome.cancelOps.length ? changeId : null, pending: outcome.cancelOps.length > 0 }
}

const endLeaseCommand: CommandHandler<LeaseEndInput, LeaseChangeResult> = {
  id: 'property_management.lease.end',
  isUndoable: false,
  async execute(rawInput, ctx) {
    return endLease(leaseEndSchema.parse(rawInput ?? {}), ctx)
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.leaseId ?? null, 'property_management.audit.lease.end', 'End lease', LEASE_RESOURCE_KIND),
}

async function deleteLease(input: LeaseIdInput, ctx: CommandRuntimeContext): Promise<LeaseChangeResult> {
  const scope = scopeOfInput(input)
  ensureScope(ctx, scope)
  const em = resolveEm(ctx)
  const permitted = await resolvePermitted(ctx, scope)
  const current = await loadPermittedLease(em, scope, permitted, input.id)
  await enforceLeaseLock(ctx, current)
  await assertNoPendingChange(current)
  const versions = await loadBilledVersions(em, scope, current.id)
  for (const version of versions) {
    const recurrence = await readRecurrence(em.fork(), scope, version.salesOrderId as string)
    if (hasIssuedInvoice(recurrence)) {
      throw await conflictError('property_management.errors.leaseInvoiced', 'This lease has been invoiced, so it cannot be deleted. End it instead.', {
        code: 'lease_invoiced',
      })
    }
  }
  const changeId = randomUUID()
  const outcome = await em.fork().transactional(async (trx) => {
    const lease = await lockLeaseRow(trx, scope, current.id)
    await assertNoPendingChange(lease)
    const statusOps: SalesOperation[] = []
    for (const proposal of await findOpenProposals(trx, scope, lease.id)) {
      const op = await closeProposal(trx, scope, lease, proposal, 'withdrawn')
      if (op) statusOps.push(op)
    }
    await releasePendingExtensions(trx, scope, lease.id)
    lease.holdToken = null
    const cancelOps: SalesOperation[] = []
    for (const [index, version] of versions.entries()) {
      cancelOps.push(
        await recordOperation(trx, scope, {
          kind: 'recurrence_cancel',
          subjectKey: `recurrence_cancel:${version.salesOrderId}:${changeId}`,
          payload: { orderId: version.salesOrderId, effectiveOn: version.startsOn, settlement: 'credit_full' },
          targetType: 'lease',
          targetId: lease.id,
          leaseId: lease.id,
          changeId,
          sequence: index + 1,
          allowCredit: true,
        }),
      )
    }
    if (cancelOps.length) {
      lease.pendingChange = { kind: 'delete', changeId, previous: previousOf(lease), operationIds: cancelOps.map((op) => op.id) }
    }
    lease.deletedAt = new Date()
    lease.updatedAt = new Date()
    await trx.flush()
    return { lease, statusOps, cancelOps }
  })
  await enqueueSalesOperations([...outcome.statusOps.map((op) => op.id), ...outcome.cancelOps.slice(0, 1).map((op) => op.id)])
  await emitSideEffects(ctx, 'deleted', outcome.lease, { indexer: leaseCrudIndexer, events: leaseCrudEvents })
  return { leaseId: outcome.lease.id, changeId: outcome.cancelOps.length ? changeId : null, pending: outcome.cancelOps.length > 0 }
}

const deleteLeaseCommand: CommandHandler<LeaseIdInput, LeaseChangeResult> = {
  id: 'property_management.lease.delete',
  isUndoable: false,
  async execute(rawInput, ctx) {
    return deleteLease(leaseIdSchema.parse(rawInput ?? {}), ctx)
  },
  buildLog: async ({ input, result, ctx }) =>
    buildCrudLog(ctx, input, result?.leaseId ?? null, 'property_management.audit.lease.delete', 'Delete lease', LEASE_RESOURCE_KIND),
}

registerCommand(createCommand('property_management.lease.create', false))
registerCommand(createCommand('property_management.lease.propose', true))
registerCommand(updateLeaseCommand)
registerCommand(endLeaseCommand)
registerCommand(deleteLeaseCommand)
