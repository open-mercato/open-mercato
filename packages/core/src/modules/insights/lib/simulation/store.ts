import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { findAndCountWithDecryption, findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  InsightsSimulationDecision,
  InsightsSimulationRun,
  type SimulationDecisionValue,
  type SimulationErrorCode,
  type SimulationRunStatus,
} from '../../data/entities'
import {
  SIMULATION_DECISION_RETENTION_MONTHS,
  SIMULATION_LIMITS,
  SIMULATION_PURGE_BATCH,
  SIMULATION_PURGE_MAX_BATCHES,
  SIMULATION_STALE_ACTIVE_MS,
} from './constants'

export type SimulationRunScope = {
  tenantId: string
  organizationId: string
}

export const SIMULATION_ACTIVE_STATUSES: SimulationRunStatus[] = ['queued', 'running']

export const SIMULATION_DEDUPE_STATUSES: SimulationRunStatus[] = ['queued', 'running', 'completed']

export function isActiveSimulationStatus(status: string): boolean {
  return status === 'queued' || status === 'running'
}

function decryptionScope(scope: SimulationRunScope) {
  return { tenantId: scope.tenantId, organizationId: scope.organizationId }
}

/** The next `updated_at` of a run: never equal to (and never before) the loaded version. */
export function nextRunVersion(previous: Date, now: number = Date.now()): Date {
  return new Date(Math.max(now, previous.getTime() + 1))
}

/**
 * A run of the scope that has not expired. With `requesterUserId` the run must also belong to that
 * user (S10: every reader sees only their own runs); callers answer the same 404 for a missing,
 * foreign, other-organization or expired run.
 */
export async function findSimulationRun(
  em: EntityManager,
  query: { scope: SimulationRunScope; runId: string; requesterUserId: string | null; now?: Date },
): Promise<InsightsSimulationRun | null> {
  const where: Record<string, unknown> = {
    id: query.runId,
    tenantId: query.scope.tenantId,
    organizationId: query.scope.organizationId,
    expiresAt: { $gt: query.now ?? new Date() },
  }
  if (query.requesterUserId !== null) where.requestedByUserId = query.requesterUserId
  const run = await findOneWithDecryption(em, InsightsSimulationRun, where, undefined, decryptionScope(query.scope))
  if (!run || run.tenantId !== query.scope.tenantId || run.organizationId !== query.scope.organizationId) return null
  if (query.requesterUserId !== null && run.requestedByUserId !== query.requesterUserId) return null
  return run
}

export async function loadSimulationRunForWorker(em: EntityManager, scope: SimulationRunScope, runId: string): Promise<InsightsSimulationRun | null> {
  const run = await findOneWithDecryption(
    em,
    InsightsSimulationRun,
    { id: runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    decryptionScope(scope),
  )
  if (!run || run.tenantId !== scope.tenantId || run.organizationId !== scope.organizationId) return null
  return run
}

export async function listSimulationRuns(
  em: EntityManager,
  query: { scope: SimulationRunScope; requesterUserId: string; kinds: string[]; page: number; pageSize: number; now?: Date },
): Promise<{ items: InsightsSimulationRun[]; total: number }> {
  if (query.kinds.length === 0) return { items: [], total: 0 }
  const pageSize = Math.min(Math.max(1, Math.trunc(query.pageSize)), 100)
  const page = Math.max(1, Math.trunc(query.page))
  const [items, total] = await findAndCountWithDecryption(
    em,
    InsightsSimulationRun,
    {
      tenantId: query.scope.tenantId,
      organizationId: query.scope.organizationId,
      requestedByUserId: query.requesterUserId,
      kind: { $in: query.kinds },
      expiresAt: { $gt: query.now ?? new Date() },
    },
    { orderBy: { createdAt: 'desc', id: 'desc' }, limit: pageSize, offset: (page - 1) * pageSize },
    decryptionScope(query.scope),
  )
  return { items, total }
}

export async function findSimulationDecisions(em: EntityManager, scope: SimulationRunScope, runId: string): Promise<InsightsSimulationDecision[]> {
  return findWithDecryption(
    em,
    InsightsSimulationDecision,
    { runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { createdAt: 'asc' } },
    decryptionScope(scope),
  )
}

export type SimulationBusyReason = 'user' | 'tenant'

export class SimulationBusyError extends Error {
  readonly reason: SimulationBusyReason

  constructor(reason: SimulationBusyReason) {
    super('[internal] Too many active simulation runs')
    this.name = 'SimulationBusyError'
    this.reason = reason
  }
}

export type NewSimulationRun = {
  scope: SimulationRunScope
  kind: string
  requesterUserId: string
  input: unknown
  inputsHash: string
  artifactKind: string
  artifactId: string | null
  artifactVersion: { updatedAt: string | null; fingerprint: string | null } | null
  proposalFingerprint: string
  windowFrom: Date
  windowTo: Date
  budgets: Record<string, unknown>
  engineVersion: number
  contributionVersion: number
  expiresAt: Date
}

export type CreateSimulationRunResult = {
  created: boolean
  run: InsightsSimulationRun
  abandoned: AbandonedSimulationRun[]
}

/**
 * S11 + S12, under one tenant advisory lock: fails stale active runs (`abandoned`, so a lost job
 * never blocks its requester for long), answers an identical live run of the same requester and
 * organization (dedupe; an expired one is purged first), enforces ≤ 2 active runs per user and
 * ≤ 5 per tenant (`SimulationBusyError`), then inserts the run (encrypted `input_json`).
 */
export async function createSimulationRun(em: EntityManager, input: NewSimulationRun, now: Date = new Date()): Promise<CreateSimulationRunResult> {
  return em.fork().transactional(async (tx) => {
    const db = tx.getKysely<unknown>()
    await sql`select pg_advisory_xact_lock(hashtextextended(${`insights.simulation.request:${input.scope.tenantId}`}, 0))`.execute(db)
    const staleBefore = new Date(now.getTime() - SIMULATION_STALE_ACTIVE_MS)
    const stale = await findWithDecryption(
      tx,
      InsightsSimulationRun,
      { tenantId: input.scope.tenantId, status: { $in: SIMULATION_ACTIVE_STATUSES }, updatedAt: { $lt: staleBefore } },
      { fields: ['id', 'tenantId', 'organizationId', 'requestedByUserId', 'progressJobId', 'updatedAt'], limit: 100 },
      { tenantId: input.scope.tenantId },
    )
    const abandoned: AbandonedSimulationRun[] = []
    for (const run of stale) {
      const affected = await tx.nativeUpdate(
        InsightsSimulationRun,
        { id: run.id, tenantId: input.scope.tenantId, status: { $in: SIMULATION_ACTIVE_STATUSES }, updatedAt: run.updatedAt },
        { status: 'failed', errorCode: 'abandoned', completedAt: now, updatedAt: nextRunVersion(run.updatedAt, now.getTime()), resultJson: null },
      )
      if (affected === 1) {
        abandoned.push({
          id: run.id,
          tenantId: run.tenantId,
          organizationId: run.organizationId,
          requestedByUserId: run.requestedByUserId,
          progressJobId: run.progressJobId ?? null,
        })
      }
    }
    const duplicate = await findOneWithDecryption(
      tx,
      InsightsSimulationRun,
      {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        kind: input.kind,
        inputsHash: input.inputsHash,
        status: { $in: SIMULATION_DEDUPE_STATUSES },
      },
      undefined,
      decryptionScope(input.scope),
    )
    if (duplicate && duplicate.expiresAt.getTime() <= now.getTime()) {
      await tx.nativeDelete(InsightsSimulationRun, { id: duplicate.id, tenantId: input.scope.tenantId })
    } else if (duplicate) {
      if (duplicate.requestedByUserId !== input.requesterUserId) throw new Error('[internal] Simulation inputs hash collision across requesters')
      return { created: false, run: duplicate, abandoned }
    }
    const activeForUser = await tx.count(InsightsSimulationRun, {
      tenantId: input.scope.tenantId,
      requestedByUserId: input.requesterUserId,
      status: { $in: SIMULATION_ACTIVE_STATUSES },
    })
    if (activeForUser >= SIMULATION_LIMITS.maxActivePerUser) throw new SimulationBusyError('user')
    const activeForTenant = await tx.count(InsightsSimulationRun, {
      tenantId: input.scope.tenantId,
      status: { $in: SIMULATION_ACTIVE_STATUSES },
    })
    if (activeForTenant >= SIMULATION_LIMITS.maxActivePerTenant) throw new SimulationBusyError('tenant')
    const run = tx.create(InsightsSimulationRun, {
      id: randomUUID(),
      tenantId: input.scope.tenantId,
      organizationId: input.scope.organizationId,
      kind: input.kind,
      status: 'queued',
      progressJobId: null,
      requestedByUserId: input.requesterUserId,
      inputJson: input.input,
      inputsHash: input.inputsHash,
      artifactKind: input.artifactKind,
      artifactId: input.artifactId,
      artifactVersionJson: input.artifactVersion,
      proposalFingerprint: input.proposalFingerprint,
      windowFrom: input.windowFrom,
      windowTo: input.windowTo,
      budgetsJson: input.budgets,
      fidelity: null,
      coverageJson: null,
      resultJson: null,
      caveats: [],
      engineVersion: input.engineVersion,
      contributionVersion: input.contributionVersion,
      errorCode: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      expiresAt: input.expiresAt,
      updatedAt: now,
    })
    await tx.flush()
    return { created: true, run, abandoned }
  })
}

export type CompletedSimulationRun = NewSimulationRun & {
  startedAt: Date
  completedAt: Date
  resultJson: unknown
  coverageJson: Record<string, number>
  caveats: string[]
  fidelity: string
}

/**
 * Stores the result of an `inline` kind as a completed run (no job, no active-run limits: nothing
 * is left running). Its inputs hash carries a per-request id, so it never collides with the
 * dedupe index; `result_json` is sealed by the encryption subscriber.
 */
export async function insertCompletedSimulationRun(em: EntityManager, input: CompletedSimulationRun): Promise<InsightsSimulationRun> {
  const fork = em.fork()
  const run = fork.create(InsightsSimulationRun, {
    id: randomUUID(),
    tenantId: input.scope.tenantId,
    organizationId: input.scope.organizationId,
    kind: input.kind,
    status: 'completed',
    progressJobId: null,
    requestedByUserId: input.requesterUserId,
    inputJson: input.input,
    inputsHash: input.inputsHash,
    artifactKind: input.artifactKind,
    artifactId: input.artifactId,
    artifactVersionJson: input.artifactVersion,
    proposalFingerprint: input.proposalFingerprint,
    windowFrom: input.windowFrom,
    windowTo: input.windowTo,
    budgetsJson: input.budgets,
    fidelity: input.fidelity,
    coverageJson: input.coverageJson,
    resultJson: input.resultJson,
    caveats: input.caveats,
    engineVersion: input.engineVersion,
    contributionVersion: input.contributionVersion,
    errorCode: null,
    createdAt: input.startedAt,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    expiresAt: input.expiresAt,
    updatedAt: input.completedAt,
  })
  await fork.flush()
  return run
}

/** Records the run's progress job while it is still active (moves its version). */
export async function attachProgressJob(em: EntityManager, run: InsightsSimulationRun, progressJobId: string): Promise<boolean> {
  const affected = await em.nativeUpdate(
    InsightsSimulationRun,
    { id: run.id, tenantId: run.tenantId, organizationId: run.organizationId, status: { $in: SIMULATION_ACTIVE_STATUSES }, updatedAt: run.updatedAt },
    { progressJobId, updatedAt: nextRunVersion(run.updatedAt) },
  )
  return affected === 1
}

export type SimulationRunPatch = {
  status?: SimulationRunStatus
  errorCode?: SimulationErrorCode | null
  startedAt?: Date | null
  completedAt?: Date | null
  resultJson?: unknown
  coverageJson?: Record<string, number> | null
  caveats?: string[]
  fidelity?: string | null
  budgetsJson?: Record<string, unknown>
}

/**
 * Compare-and-set write of an ACTIVE run: inside a transaction the row is locked, and the write
 * happens only while the run is still queued/running at the version the caller loaded (`expected`).
 * Writes go through the ORM so the encryption subscriber seals `result_json`. Returns the saved
 * run, or `null` when another writer won (the caller drops its work).
 */
export async function updateActiveSimulationRun(
  em: EntityManager,
  scope: SimulationRunScope,
  runId: string,
  expected: Date | null,
  patch: SimulationRunPatch,
  now: number = Date.now(),
): Promise<InsightsSimulationRun | null> {
  return em.fork().transactional(async (tx) => {
    const run = await findOneWithDecryption(
      tx,
      InsightsSimulationRun,
      { id: runId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      decryptionScope(scope),
    )
    if (!run || !isActiveSimulationStatus(run.status)) return null
    if (expected !== null && run.updatedAt.getTime() !== expected.getTime()) return null
    if (patch.status !== undefined) run.status = patch.status
    if (patch.errorCode !== undefined) run.errorCode = patch.errorCode
    if (patch.startedAt !== undefined) run.startedAt = patch.startedAt
    if (patch.completedAt !== undefined) run.completedAt = patch.completedAt
    if (patch.resultJson !== undefined) run.resultJson = patch.resultJson
    if (patch.coverageJson !== undefined) run.coverageJson = patch.coverageJson
    if (patch.caveats !== undefined) run.caveats = patch.caveats
    if (patch.fidelity !== undefined) run.fidelity = patch.fidelity
    if (patch.budgetsJson !== undefined) run.budgetsJson = patch.budgetsJson
    run.updatedAt = nextRunVersion(run.updatedAt, now)
    await tx.flush()
    return run
  })
}

export type NewSimulationDecision = {
  run: InsightsSimulationRun
  decision: SimulationDecisionValue
  decidedByUserId: string
  artifactId: string | null
  artifactUpdatedAtAfter: Date | null
  verified: boolean | null
}

export class SimulationDecisionExistsError extends Error {
  constructor() {
    super('[internal] The decision was already recorded for this run')
    this.name = 'SimulationDecisionExistsError'
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { code?: unknown; name?: unknown; cause?: unknown }
  if (record.code === '23505' || record.name === 'UniqueConstraintViolationException') return true
  return record.cause !== undefined && record.cause !== error ? isUniqueViolation(record.cause) : false
}

/** Appends a decision (S16); tenant and organization come from the run. Duplicates raise `SimulationDecisionExistsError`. */
export async function insertSimulationDecision(em: EntityManager, input: NewSimulationDecision): Promise<InsightsSimulationDecision> {
  const fork = em.fork()
  const existing = await fork.count(InsightsSimulationDecision, { runId: input.run.id, decision: input.decision })
  if (existing > 0) throw new SimulationDecisionExistsError()
  const decision = fork.create(InsightsSimulationDecision, {
    id: randomUUID(),
    tenantId: input.run.tenantId,
    organizationId: input.run.organizationId,
    runId: input.run.id,
    decision: input.decision,
    decidedByUserId: input.decidedByUserId,
    artifactKind: input.run.artifactKind,
    artifactId: input.artifactId,
    artifactUpdatedAtAfter: input.artifactUpdatedAtAfter,
    verified: input.verified,
    createdAt: new Date(),
  })
  try {
    await fork.flush()
  } catch (error) {
    if (isUniqueViolation(error)) throw new SimulationDecisionExistsError()
    throw error
  }
  return decision
}

export type ErasedSimulationRuns = {
  deleted: number
  progressJobIds: Array<{ progressJobId: string; organizationId: string }>
}

async function deleteRunsInBatches(em: EntityManager, where: Record<string, unknown>): Promise<ErasedSimulationRuns> {
  let deleted = 0
  const progressJobIds: ErasedSimulationRuns['progressJobIds'] = []
  for (let batch = 0; batch < SIMULATION_PURGE_MAX_BATCHES; batch += 1) {
    const rows = await findWithDecryption(em.fork(), InsightsSimulationRun, where, { fields: ['id', 'status', 'progressJobId', 'organizationId'], limit: SIMULATION_PURGE_BATCH })
    if (rows.length === 0) break
    for (const row of rows) {
      if (row.progressJobId && isActiveSimulationStatus(row.status)) progressJobIds.push({ progressJobId: row.progressJobId, organizationId: row.organizationId })
    }
    deleted += await em.fork().nativeDelete(InsightsSimulationRun, { ...where, id: { $in: rows.map((row) => row.id) } })
    if (rows.length < SIMULATION_PURGE_BATCH) break
  }
  return { deleted, progressJobIds }
}

export type AbandonedSimulationRun = {
  id: string
  tenantId: string
  organizationId: string
  requestedByUserId: string
  progressJobId: string | null
}

/**
 * Fails every queued/running run whose version has not moved for `SIMULATION_STALE_ACTIVE_MS`
 * (`abandoned`: its job was lost), in bounded batches, so it stops counting against the limits.
 */
export async function abandonStaleSimulationRuns(em: EntityManager, now: Date = new Date()): Promise<AbandonedSimulationRun[]> {
  const staleBefore = new Date(now.getTime() - SIMULATION_STALE_ACTIVE_MS)
  const abandoned: AbandonedSimulationRun[] = []
  for (let batch = 0; batch < SIMULATION_PURGE_MAX_BATCHES; batch += 1) {
    const rows = await findWithDecryption(
      em.fork(),
      InsightsSimulationRun,
      { status: { $in: SIMULATION_ACTIVE_STATUSES }, updatedAt: { $lt: staleBefore } },
      { fields: ['id', 'tenantId', 'organizationId', 'requestedByUserId', 'progressJobId', 'updatedAt'], limit: SIMULATION_PURGE_BATCH },
    )
    if (rows.length === 0) break
    for (const row of rows) {
      const affected = await em.fork().nativeUpdate(
        InsightsSimulationRun,
        { id: row.id, tenantId: row.tenantId, status: { $in: SIMULATION_ACTIVE_STATUSES }, updatedAt: row.updatedAt },
        { status: 'failed', errorCode: 'abandoned', completedAt: now, updatedAt: nextRunVersion(row.updatedAt, now.getTime()), resultJson: null },
      )
      if (affected === 1) {
        abandoned.push({
          id: row.id,
          tenantId: row.tenantId,
          organizationId: row.organizationId,
          requestedByUserId: row.requestedByUserId,
          progressJobId: row.progressJobId ?? null,
        })
      }
    }
    if (rows.length < SIMULATION_PURGE_BATCH) break
  }
  return abandoned
}

/** S17: removes expired runs in bounded batches (the daily tick). */
export async function purgeExpiredSimulationRuns(em: EntityManager, now: Date = new Date()): Promise<number> {
  const { deleted } = await deleteRunsInBatches(em, { expiresAt: { $lte: now } })
  return deleted
}

/** S16: decisions are retained 13 months. */
export async function purgeOldSimulationDecisions(em: EntityManager, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime())
  cutoff.setUTCMonth(cutoff.getUTCMonth() - SIMULATION_DECISION_RETENTION_MONTHS)
  let deleted = 0
  for (let batch = 0; batch < SIMULATION_PURGE_MAX_BATCHES; batch += 1) {
    const rows = await findWithDecryption(em.fork(), InsightsSimulationDecision, { createdAt: { $lt: cutoff } }, { fields: ['id'], limit: SIMULATION_PURGE_BATCH })
    if (rows.length === 0) break
    deleted += await em.fork().nativeDelete(InsightsSimulationDecision, { id: { $in: rows.map((row) => row.id) } })
    if (rows.length < SIMULATION_PURGE_BATCH) break
  }
  return deleted
}

/** S18: the deleted user's runs disappear; returns the progress jobs of runs that were still active. */
export async function deleteSimulationRunsOfUser(em: EntityManager, tenantId: string, userId: string): Promise<ErasedSimulationRuns> {
  return deleteRunsInBatches(em, { tenantId, requestedByUserId: userId })
}

/**
 * S18: the deleted user's decisions keep their meaning (counts) but lose the identity: every
 * decision of the user in the tenant gets the same fresh random `erased:<uuid>` token, never
 * derived from the user id and never restored.
 */
export async function eraseSimulationDecider(em: EntityManager, tenantId: string, userId: string): Promise<number> {
  const token = `erased:${randomUUID()}`
  return em.fork().nativeUpdate(InsightsSimulationDecision, { tenantId, decidedByUserId: userId }, { decidedByUserId: token })
}

export async function deleteSimulationRunsOfScope(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string | null },
): Promise<ErasedSimulationRuns> {
  const where: Record<string, unknown> = { tenantId: scope.tenantId }
  if (scope.organizationId) where.organizationId = scope.organizationId
  return deleteRunsInBatches(em, where)
}

export function simulationRunBudgets(): Record<string, unknown> {
  return {
    maxRecords: SIMULATION_LIMITS.maxRecords,
    maxDurationMs: SIMULATION_LIMITS.maxDurationMs,
    maxWindowDays: SIMULATION_LIMITS.maxWindowDays,
    maxBatchBytes: SIMULATION_LIMITS.maxBatchBytes,
    maxBatchRows: SIMULATION_LIMITS.maxBatchRows,
    recordsUsed: 0,
    elapsedMs: 0,
    slices: 0,
  }
}
