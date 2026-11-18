import type { AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runWithCacheTenant, type CacheStrategy } from '@open-mercato/cache'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { Lease, LeaseProposal, LeaseVersion, SalesOperation } from '../data/entities'
import { buildTrustedSalesContext } from './salesCommandContext'
import { compareIsoDates, localToday } from './leaseTerm'
import { isProposalExpired } from './leaseProposalLifecycle'
import { lockLeaseRow } from './leaseRecords'
import { emitLeaseEvent, markLeaseChanged } from './leaseEvents'
import { OPEN_PROPOSAL_STATUSES } from './leaseOccupancy'
import { enqueueSalesOperations, type OperationEnqueuer } from './salesOperations'
import type { Scope } from './productUse'
import { isCursorId, resolveSweepCache, SWEEP_CURSOR_TTL_MS } from './sweepCache'

const logger = createLogger('property_management')

export { LEASE_SWEEP_QUEUE } from './queues'
const SWEEP_BATCH = 500
const SWEEP_MAX_PAGES = 20
export const LEASE_SWEEP_MAX_END_ATTEMPTS = 500
export const LEASE_SWEEP_MAX_CONSECUTIVE_FAILURES = 20

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

async function hasPendingExtension(trx: EntityManager, scope: Scope, leaseId: string): Promise<boolean> {
  const versions = await findWithDecryption(
    trx,
    LeaseVersion,
    { ...scope, leaseId, state: 'pending', holdToken: { $ne: null } },
    { limit: 1, refresh: true },
    scope,
  )
  if (versions.length) return true
  const proposals = await findWithDecryption(
    trx,
    LeaseProposal,
    { ...scope, leaseId, kind: 'extension', status: { $in: [...OPEN_PROPOSAL_STATUSES] } },
    { limit: 1, refresh: true },
    scope,
  )
  return proposals.length > 0
}

export type LeaseEndCursor = { endsOn: string; id: string }

type LeaseEndRange = { after: LeaseEndCursor | null; upTo: LeaseEndCursor | null }

type PastTermLease = Pick<Lease, 'id' | 'endsOn'>

type LeaseEndRun = { ended: number; attempts: number; consecutiveFailures: number }

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function leaseEndCursorKey(scope: Scope): string {
  return `property_management:lease_sweep:end_cursor:${scope.tenantId}:${scope.organizationId}`
}

function parseLeaseEndCursor(value: unknown): LeaseEndCursor | null {
  if (!value || typeof value !== 'object') return null
  const { endsOn, id } = value as Record<string, unknown>
  return typeof endsOn === 'string' && ISO_DATE_PATTERN.test(endsOn) && isCursorId(id) ? { endsOn, id } : null
}

function reportLeaseEndCursorFailure(operation: 'load' | 'save', scope: Scope, err: unknown): void {
  logger.warn('The lease sweep cursor is unavailable; ending leases starts from the oldest past term', {
    operation,
    organizationId: scope.organizationId,
    err,
  })
  getTelemetryRuntime()?.reportError(err, {
    module: 'property_management',
    code: 'property_management.lease_sweep_cursor_failed',
    attributes: { operation },
  })
}

async function loadLeaseEndCursor(cache: CacheStrategy | null, scope: Scope): Promise<LeaseEndCursor | null> {
  if (!cache) return null
  const key = leaseEndCursorKey(scope)
  try {
    return await runWithCacheTenant(scope.tenantId, async () => {
      const stored = await cache.get(key)
      if (stored === null || stored === undefined) return null
      const cursor = parseLeaseEndCursor(stored)
      if (!cursor) await cache.delete(key)
      return cursor
    })
  } catch (err) {
    reportLeaseEndCursorFailure('load', scope, err)
    return null
  }
}

async function saveLeaseEndCursor(cache: CacheStrategy | null, scope: Scope, cursor: LeaseEndCursor | null): Promise<void> {
  if (!cache) return
  const key = leaseEndCursorKey(scope)
  try {
    await runWithCacheTenant(scope.tenantId, async () => {
      if (cursor) await cache.set(key, cursor, { ttl: SWEEP_CURSOR_TTL_MS })
      else await cache.delete(key)
    })
  } catch (err) {
    reportLeaseEndCursorFailure('save', scope, err)
  }
}

function leaseEndCursorOf(lease: PastTermLease): LeaseEndCursor {
  return { endsOn: lease.endsOn, id: lease.id }
}

function leaseEndRangeFilters(range: LeaseEndRange): Record<string, unknown>[] {
  const filters: Record<string, unknown>[] = []
  const { after, upTo } = range
  if (after) filters.push({ $or: [{ endsOn: { $gt: after.endsOn } }, { endsOn: after.endsOn, id: { $gt: after.id } }] })
  if (upTo) filters.push({ $or: [{ endsOn: { $lt: upTo.endsOn } }, { endsOn: upTo.endsOn, id: { $lte: upTo.id } }] })
  return filters
}

async function loadPastTermLeases(deps: LeaseSweepDeps, scope: Scope, today: string, range: LeaseEndRange): Promise<PastTermLease[]> {
  const where: Record<string, unknown> = { ...scope, status: 'active', pendingChange: null, deletedAt: null, endsOn: { $lt: today } }
  const filters = leaseEndRangeFilters(range)
  if (filters.length) where.$and = filters
  return findWithDecryption(
    deps.em.fork(),
    Lease,
    where,
    { limit: SWEEP_BATCH, orderBy: { endsOn: 'asc', id: 'asc' }, fields: ['id', 'endsOn'] },
    scope,
  )
}

function isLeaseEndRunExhausted(run: LeaseEndRun): boolean {
  return run.attempts >= LEASE_SWEEP_MAX_END_ATTEMPTS || run.consecutiveFailures >= LEASE_SWEEP_MAX_CONSECUTIVE_FAILURES
}

async function endLeaseIfPastTerm(deps: LeaseSweepDeps, scope: Scope, today: string, leaseId: string): Promise<boolean> {
  const lease = await deps.em.fork().transactional(async (trx) => {
    const locked = await lockLeaseRow(trx, scope, leaseId)
    if (locked.status !== 'active' || locked.pendingChange || compareIsoDates(locked.endsOn, today) >= 0) return null
    if (await hasPendingExtension(trx, scope, locked.id)) return null
    locked.status = 'ended'
    locked.updatedAt = new Date()
    await trx.flush()
    return locked
  })
  if (!lease) return false
  await markLeaseChanged(deps.container, lease, 'updated')
  await emitLeaseEvent('property_management.lease.ended', lease)
  return true
}

async function endPage(
  deps: LeaseSweepDeps,
  scope: Scope,
  today: string,
  run: LeaseEndRun,
  candidates: readonly PastTermLease[],
): Promise<LeaseEndCursor | null> {
  let visited: LeaseEndCursor | null = null
  for (const candidate of candidates) {
    if (isLeaseEndRunExhausted(run)) break
    visited = leaseEndCursorOf(candidate)
    run.attempts += 1
    try {
      if (await endLeaseIfPastTerm(deps, scope, today, candidate.id)) run.ended += 1
      run.consecutiveFailures = 0
    } catch (err) {
      run.consecutiveFailures += 1
      logger.error('Ending a lease past its term failed', { leaseId: candidate.id, err })
      getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.lease_sweep_end_failed' })
    }
  }
  return visited
}

async function endLeasesPastTerm(deps: LeaseSweepDeps, scope: Scope, today: string): Promise<number> {
  const cache = resolveSweepCache(deps.container)
  const start = await loadLeaseEndCursor(cache, scope)
  const run: LeaseEndRun = { ended: 0, attempts: 0, consecutiveFailures: 0 }
  let range: LeaseEndRange | null = { after: start, upTo: null }
  let wrapped = start === null
  let resumeAt: LeaseEndCursor | null = null
  for (let page = 1; range && page <= SWEEP_MAX_PAGES; page += 1) {
    const candidates = await loadPastTermLeases(deps, scope, today, range)
    resumeAt = (await endPage(deps, scope, today, run, candidates)) ?? resumeAt
    if (isLeaseEndRunExhausted(run)) break
    if (candidates.length >= SWEEP_BATCH) {
      range = { ...range, after: leaseEndCursorOf(candidates[candidates.length - 1]) }
    } else if (wrapped) {
      range = null
    } else {
      wrapped = true
      range = { after: null, upTo: start }
    }
  }
  await saveLeaseEndCursor(cache, scope, range ? resumeAt : null)
  if (run.consecutiveFailures >= LEASE_SWEEP_MAX_CONSECUTIVE_FAILURES) {
    logger.warn('Ending leases past their term kept failing; the lease sweep stops for this run and continues after them on the next one', {
      consecutiveFailures: run.consecutiveFailures,
      organizationId: scope.organizationId,
    })
  }
  return run.ended
}

async function runProposalCommands(deps: LeaseSweepDeps, scope: Scope, today: string): Promise<number> {
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
  for (const proposal of proposals) {
    if (!isProposalExpired(proposal.respondBy, today)) continue
    const input = { id: proposal.id, ...scope }
    try {
      const { result } = await commandBus.execute<typeof input, { changed: boolean }>('property_management.lease_proposal.expire', { input, ctx })
      if (result?.changed) expired += 1
    } catch (err) {
      logger.error('Lease proposal sweep step failed', { proposalId: proposal.id, err })
      getTelemetryRuntime()?.reportError(err, { module: 'property_management', code: 'property_management.lease_sweep_proposal_failed' })
    }
  }
  return expired
}

export function reenqueueCursorKey(scope: Scope): string {
  return `property_management:operation_reenqueue:cursor:${scope.tenantId}:${scope.organizationId}`
}

function reportReenqueueCursorFailure(operation: 'load' | 'save', scope: Scope, err: unknown): void {
  logger.warn('The operation re-enqueue cursor is unavailable; re-enqueueing starts from the first open operation', {
    operation,
    organizationId: scope.organizationId,
    err,
  })
  getTelemetryRuntime()?.reportError(err, {
    module: 'property_management',
    code: 'property_management.operation_reenqueue_cursor_failed',
    attributes: { operation },
  })
}

async function loadReenqueueCursor(cache: CacheStrategy | null, scope: Scope): Promise<string | null> {
  if (!cache) return null
  try {
    const value = await runWithCacheTenant(scope.tenantId, () => cache.get(reenqueueCursorKey(scope)))
    return isCursorId(value) ? value : null
  } catch (err) {
    reportReenqueueCursorFailure('load', scope, err)
    return null
  }
}

async function saveReenqueueCursor(cache: CacheStrategy | null, scope: Scope, cursor: string | null): Promise<void> {
  if (!cache) return
  const key = reenqueueCursorKey(scope)
  try {
    await runWithCacheTenant(scope.tenantId, async () => {
      if (cursor) await cache.set(key, cursor, { ttl: SWEEP_CURSOR_TTL_MS })
      else await cache.delete(key)
    })
  } catch (err) {
    reportReenqueueCursorFailure('save', scope, err)
  }
}

async function lockOpenOperations(trx: EntityManager, scope: Scope, idFilter: Record<string, string> | null, limit: number): Promise<string[]> {
  const rows = await findWithDecryption(
    trx,
    SalesOperation,
    { ...scope, status: { $in: ['pending', 'compensating'] }, ...(idFilter ? { id: idFilter } : {}) },
    { lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE, limit, orderBy: { id: 'asc' }, fields: ['id'] },
    scope,
  )
  return rows.map((row) => row.id)
}

export async function reenqueueOpenOperations(deps: LeaseSweepDeps, scope: Scope): Promise<number> {
  const cache = resolveSweepCache(deps.container)
  const start = await loadReenqueueCursor(cache, scope)
  const ids = await deps.em.fork().transactional(async (trx) => {
    const page = await lockOpenOperations(trx, scope, start ? { $gt: start } : null, SWEEP_BATCH)
    if (!start || page.length >= SWEEP_BATCH) return page
    return [...page, ...(await lockOpenOperations(trx, scope, { $lte: start }, SWEEP_BATCH - page.length))]
  })
  await saveReenqueueCursor(cache, scope, ids.length >= SWEEP_BATCH ? ids[ids.length - 1] : null)
  await (deps.enqueuer ?? enqueueSalesOperations)(ids)
  return ids.length
}

async function sweepStep<T>(step: string, scope: Scope, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    logger.error('A lease sweep step failed; the sweep continues with the next one', { step, organizationId: scope.organizationId, err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'property_management',
      code: 'property_management.lease_sweep_step_failed',
      attributes: { step },
    })
    return fallback
  }
}

export async function runLeaseSweep(deps: LeaseSweepDeps, scope: Scope): Promise<LeaseSweepSummary> {
  const today = deps.today ?? localToday()
  const expired = await sweepStep('proposals', scope, 0, () => runProposalCommands(deps, scope, today))
  const ended = await sweepStep('end_leases_past_term', scope, 0, () => endLeasesPastTerm(deps, scope, today))
  const reenqueued = await sweepStep('reenqueue_operations', scope, 0, () => reenqueueOpenOperations(deps, scope))
  return { ended, expired, reminded: 0, reenqueued }
}

export async function listSweepScopes(em: EntityManager): Promise<Scope[]> {
  const rows = await em.getConnection().execute<Array<{ organization_id: string; tenant_id: string }>>(
    'select distinct organization_id, tenant_id from property_management_buildings',
    [],
  )
  return rows.map((row) => ({ organizationId: String(row.organization_id), tenantId: String(row.tenant_id) }))
}

export type SweepScopePayload = { scope?: { tenantId?: string | null; organizationId?: string | null } } | null | undefined

export async function resolveTrustedSweepScope(em: EntityManager, payload: SweepScopePayload, sweep: 'lease' | 'booking'): Promise<Scope | null> {
  const tenantId = payload?.scope?.tenantId
  const organizationId = payload?.scope?.organizationId
  if (typeof tenantId !== 'string' || !tenantId || typeof organizationId !== 'string' || !organizationId) return null
  const scope: Scope = { tenantId, organizationId }
  const organization = await findOneWithDecryption(em, Organization, { id: organizationId, tenant: tenantId, deletedAt: null }, { fields: ['id'] }, scope)
  if (organization) return scope
  logger.error('A sweep job named an organization outside its tenant; skipping it', { sweep, tenantId, organizationId })
  getTelemetryRuntime()?.reportError(new Error('[internal] Sweep job scope does not match an organization of its tenant'), {
    module: 'property_management',
    code: 'property_management.sweep_scope_rejected',
    attributes: { sweep, tenantId, organizationId },
  })
  return null
}
