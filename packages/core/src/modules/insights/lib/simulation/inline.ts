import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type {
  SimulationFeatureCheck,
  SimulationKindDefinition,
  SimulationRunContext,
  SimulationScope,
  SimulationServiceResolver,
} from '@open-mercato/shared/modules/insights/simulate'
import { SIMULATION_LIMITS } from './constants'
import { createAuditScanner, createRecordHistoryReader, withPastValuePolicy } from './context'
import {
  resolveKAnonymity,
  sanitizeSimulationSummary,
  storedSimulationCoverage,
  type StoredSimulationResult,
} from './jobs'
import { suppressSimulationGroups } from './privacy'
import { listSimulationEventAdapters } from './registry'
import { confirmSimulationSamples } from './samples'

const logger = createLogger('insights').child({ component: 'simulation-inline' })

type Resolver = { resolve: (name: string) => unknown }

/** A resolver over a DI container that answers `undefined` for services that are not registered. */
export function createServiceResolver(container: Resolver): SimulationServiceResolver {
  return <TService>(name: string): TService | undefined => {
    try {
      return container.resolve(name) as TService
    } catch {
      return undefined
    }
  }
}

/**
 * The organizations a kind may read live for a requester (D10): the request's allowed
 * organizations (`null` = every organization of the tenant, `[]` = none); without a resolved
 * request scope, only the run's own organization.
 */
export function simulationScopeOrganizationIds(
  organizationScope: { allowedIds?: string[] | null } | null | undefined,
  organizationId: string,
): string[] | null {
  if (!organizationScope) return [organizationId]
  if (organizationScope.allowedIds === null) return null
  return Array.isArray(organizationScope.allowedIds) ? organizationScope.allowedIds.map((id) => id.toLowerCase()) : [organizationId]
}

/** The access log could not record the read, so the read does not happen (fail closed). */
export class SimulationAccessLogUnavailableError extends Error {
  constructor() {
    super('[internal] The simulation access log is unavailable')
    this.name = 'SimulationAccessLogUnavailableError'
  }
}

/** An inline kind did not finish in its single slice. */
export class SimulationInlineRunError extends Error {
  constructor() {
    super('[internal] An inline simulation kind did not complete in one slice')
    this.name = 'SimulationInlineRunError'
  }
}

export type SimulationAccessLogEntry = {
  scope: SimulationScope
  actorUserId: string
  resourceKind: string
  resourceId: string
  accessType: string
  context: Record<string, unknown>
}

type AccessLogWriter = {
  log: (entry: {
    tenantId: string
    organizationId: string
    actorUserId: string
    resourceKind: string
    resourceId: string
    accessType: string
    context: Record<string, unknown>
  }) => Promise<unknown>
}

/**
 * Writes one `access_logs` row before a kind reads person-related live data (its
 * `accessLogResourceKind`). Fails closed: without the audit module's `accessLogService`, or when
 * it throws or reports no row, `SimulationAccessLogUnavailableError` stops the read.
 */
export async function writeSimulationAccessLog(resolve: SimulationServiceResolver, entry: SimulationAccessLogEntry): Promise<void> {
  const writer = resolve<AccessLogWriter>('accessLogService')
  if (!writer || typeof writer.log !== 'function') throw new SimulationAccessLogUnavailableError()
  let written: unknown
  try {
    written = await writer.log({
      tenantId: entry.scope.tenantId,
      organizationId: entry.scope.organizationId,
      actorUserId: entry.actorUserId,
      resourceKind: entry.resourceKind,
      resourceId: entry.resourceId,
      accessType: entry.accessType,
      context: entry.context,
    })
  } catch (error) {
    logger.error('[internal] Could not write the simulation access log', { resourceKind: entry.resourceKind, err: error })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_access_log_failed' })
    throw new SimulationAccessLogUnavailableError()
  }
  if (written === null || written === undefined || written === false) {
    const error = new SimulationAccessLogUnavailableError()
    logger.error('[internal] The simulation access log reported no row written', { resourceKind: entry.resourceKind })
    getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_access_log_not_written' })
    throw error
  }
}

export type InlineSimulationRequest = {
  definition: SimulationKindDefinition
  input: unknown
  scope: SimulationScope
  requesterUserId: string
  artifactId: string | null
  organizationIds: readonly string[] | null
  hasFeatures: SimulationFeatureCheck
  resolve: SimulationServiceResolver
  now: () => number
}

/**
 * Runs `run` in a READ ONLY transaction whose statements are bounded by the simulator's statement
 * timeout (an inline kind evaluates, never writes).
 */
export async function runInReadOnlyTransaction<T>(em: EntityManager, run: (trx: EntityManager) => Promise<T>): Promise<T> {
  return em.fork().transactional(async (trx) => {
    await sql`set local statement_timeout = ${sql.lit(SIMULATION_LIMITS.statementTimeoutMs)}`.execute(trx.getKysely<unknown>())
    return run(trx)
  }, { readOnly: true })
}

export type InlineSimulationDeps = {
  runReadOnly?: <T>(em: EntityManager, run: (trx: EntityManager) => Promise<T>) => Promise<T>
}

export type InlineSimulationOutcome = {
  stored: StoredSimulationResult
  coverage: Record<string, number>
  caveats: string[]
  fidelity: string
  recordsProcessed: number
  startedAt: number
  completedAt: number
}

/**
 * Computes an `inline` kind (S8/S12): its single slice runs in a READ ONLY transaction bounded by
 * the statement timeout, with the requester's organization scope and the app-process services
 * (`ctx.inline`), and must answer `done`. The result then gets exactly the privacy of a queued
 * completion: k-suppression with the organization's k, sample ids confirmed through the owning
 * module's `loadCurrent`, sanitized coverage, caveats and summary. Nothing is written here.
 */
export async function runInlineSimulation(
  container: Resolver,
  rootEm: EntityManager,
  request: InlineSimulationRequest,
  deps: InlineSimulationDeps = {},
): Promise<InlineSimulationOutcome> {
  const runReadOnly = deps.runReadOnly ?? runInReadOnlyTransaction
  const startedAt = request.now()
  const window = { from: new Date(startedAt), to: new Date(startedAt) }
  const encryption = request.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  const slice = await runReadOnly(rootEm, async (trx) => {
    const context: SimulationRunContext<unknown> = {
      em: trx,
      scope: request.scope,
      requesterUserId: request.requesterUserId,
      artifactId: request.artifactId,
      window,
      budget: {
        recordsRemaining: SIMULATION_LIMITS.maxRecords,
        sliceDeadlineAt: startedAt + SIMULATION_LIMITS.sliceMs,
        runDeadlineAt: startedAt + SIMULATION_LIMITS.sliceMs,
        maxBatchRows: SIMULATION_LIMITS.maxBatchRows,
        maxBatchBytes: SIMULATION_LIMITS.maxBatchBytes,
      },
      state: null,
      now: request.now,
      hasFeatures: request.hasFeatures,
      eventAdapters: withPastValuePolicy(listSimulationEventAdapters(), false),
      scanAuditLog: createAuditScanner(trx, encryption, request.scope, window, SIMULATION_LIMITS.maxBatchBytes),
      readRecordHistory: createRecordHistoryReader(trx, encryption, request.scope),
      inline: { organizationIds: request.organizationIds, resolve: request.resolve },
    }
    return request.definition.run(request.input, context)
  })
  if (!slice || slice.status !== 'done') throw new SimulationInlineRunError()
  const result = slice.result
  const em = rootEm.fork()
  const k = await resolveKAnonymity(em, request.scope)
  const suppressed = suppressSimulationGroups(Array.isArray(result.groups) ? result.groups : [], k, request.definition.cellKeys)
  const groups = await confirmSimulationSamples(container, em, request.scope, request.requesterUserId, request.hasFeatures, suppressed)
  const summary = sanitizeSimulationSummary(result.summary)
  const visible = storedSimulationCoverage(result, groups)
  return {
    stored: { k, truncated: result.truncated === true, groups, ...(summary ? { summary } : {}) },
    coverage: visible.coverage,
    caveats: visible.caveats,
    fidelity: typeof result.fidelity === 'string' ? result.fidelity : 'none',
    recordsProcessed: Math.max(0, Math.floor(Number.isFinite(slice.recordsProcessed) ? slice.recordsProcessed : 0)),
    startedAt,
    completedAt: request.now(),
  }
}
