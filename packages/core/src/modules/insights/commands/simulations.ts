import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import type { SimulationRunStatus } from '../data/entities'
import {
  simulationCancelCommandSchema,
  simulationDecisionCommandSchema,
  simulationRequestCommandSchema,
  type SimulationCancelCommandInput,
  type SimulationDecisionCommandInput,
  type SimulationRequestCommandInput,
} from '../data/validators'
import {
  SIMULATION_DECISION_RESOURCE_KIND,
  SIMULATION_DEFAULT_TTL_HOURS,
  SIMULATION_ENGINE_VERSION,
  SIMULATION_JOB_TYPE,
  SIMULATION_RUN_FEATURE,
  SIMULATION_RUN_RESOURCE_KIND,
} from '../lib/simulation/constants'
import { createFeatureCheck } from '../lib/simulation/context'
import { simulationRunFeatures, storedRunFeatures } from '../lib/simulation/features'
import { computeSimulationInputsHash } from '../lib/simulation/hash'
import { settleSimulationProgress } from '../lib/simulation/jobs'
import { enqueueSimulationSlice, ensureSimulationMaintenanceSchedule } from '../lib/simulation/queue'
import { getSimulationKind, listSimulationEventAdapters } from '../lib/simulation/registry'
import {
  SimulationBusyError,
  SimulationDecisionExistsError,
  attachProgressJob,
  createSimulationRun,
  findSimulationRun,
  insertSimulationDecision,
  isActiveSimulationStatus,
  simulationRunBudgets,
  updateActiveSimulationRun,
} from '../lib/simulation/store'
import { toSimulationDecisionView, type SimulationDecisionView } from '../lib/simulation/views'
import { verifyAppliedDecision } from '../lib/simulation/verification'

const logger = createLogger('insights').child({ component: 'simulation-commands' })

export const SIMULATION_REQUEST_COMMAND_ID = 'insights.simulation.request'
export const SIMULATION_CANCEL_COMMAND_ID = 'insights.simulation.cancel'
export const SIMULATION_DECISION_COMMAND_ID = 'insights.simulation.decision.record'

const HOUR_MS = 60 * 60 * 1000

export type SimulationRequestResult = {
  runId: string
  progressJobId: string | null
  status: SimulationRunStatus
  created: boolean
}

export type SimulationCancelResult = {
  runId: string
  status: SimulationRunStatus
}

export type SimulationDecisionResult = {
  id: string
  runId: string
  decision: SimulationDecisionView
}

function tryResolve<TService>(ctx: CommandRuntimeContext, name: string): TService | undefined {
  try {
    return ctx.container.resolve(name) as TService
  } catch {
    return undefined
  }
}

function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

async function httpError(status: number, code: string, extra: Record<string, unknown> = {}): Promise<CrudHttpError> {
  const { t } = await resolveTranslations()
  return new CrudHttpError(status, { error: t(`insights.simulation.errors.${code}`), code, ...extra })
}

function zodIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: issue.message,
  }))
}

/**
 * `insights.simulation.request`: validates the proposal with the kind's own schema and checks,
 * captures the artifact version and the proposal fingerprint on the server (S15), dedupes per
 * requester and organization and enforces the active-run limits under the tenant lock (S11, S12),
 * then creates the minimal ProgressJob (S13: generic name, `meta = { runId }`, percent only) and
 * enqueues the first slice (payload ids only). The proposal never reaches the audit log
 * (`replayable: false`); a deduplicated request writes no audit entry.
 */
const requestSimulationCommand: CommandHandler<SimulationRequestCommandInput, SimulationRequestResult> = {
  id: SIMULATION_REQUEST_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = simulationRequestCommandSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const registered = getSimulationKind(input.kind)
    if (!registered) throw await httpError(422, 'unsupported_kind')
    const definition = registered.definition
    const hasFeatures = createFeatureCheck(ctx.container, input.userId, scope)
    if (!(await hasFeatures([SIMULATION_RUN_FEATURE, ...definition.requiredFeatures]))) throw await httpError(403, 'forbidden')
    const parsed = definition.inputSchema.safeParse(input.proposal)
    if (!parsed.success) throw await httpError(422, 'invalid_proposal', { issues: zodIssues(parsed.error) })
    const runFeatures = simulationRunFeatures(definition, parsed.data)
    if (!(await hasFeatures(runFeatures))) throw await httpError(403, 'forbidden', { requiredFeatures: runFeatures })
    const em = resolveEm(ctx)
    if (definition.validate) {
      const validation = await definition.validate(parsed.data, { em, scope, eventAdapters: listSimulationEventAdapters(), artifactId: input.artifactId })
      if (!validation.ok) throw await httpError(422, validation.code)
    }
    const version = await definition.readArtifactVersion({ em, scope }, { artifactId: input.artifactId, input: parsed.data })
    if (input.artifactId && !version) throw await httpError(422, 'artifact_not_found')
    const artifactVersion = version ? { updatedAt: version.updatedAt, fingerprint: version.fingerprint } : null
    const artifactId = version?.artifactId ?? input.artifactId
    const windowFrom = new Date(input.windowFrom)
    const windowTo = new Date(input.windowTo)
    const now = new Date()
    const inputsHash = computeSimulationInputsHash({
      kind: definition.kind,
      proposal: parsed.data,
      artifactKind: definition.artifactKind,
      artifactId,
      artifactVersion,
      windowFrom,
      windowTo,
      engineVersion: SIMULATION_ENGINE_VERSION,
      contributionVersion: definition.version,
      requesterUserId: input.userId,
      organizationId: input.organizationId,
    })
    let created
    try {
      created = await createSimulationRun(em, {
        scope,
        kind: definition.kind,
        requesterUserId: input.userId,
        input: parsed.data,
        inputsHash,
        artifactKind: definition.artifactKind,
        artifactId,
        artifactVersion,
        proposalFingerprint: definition.fingerprintProposal(parsed.data),
        windowFrom,
        windowTo,
        budgets: simulationRunBudgets(),
        engineVersion: SIMULATION_ENGINE_VERSION,
        contributionVersion: definition.version,
        expiresAt: new Date(now.getTime() + (definition.ttlHours ?? SIMULATION_DEFAULT_TTL_HOURS) * HOUR_MS),
      }, now)
    } catch (error) {
      if (error instanceof SimulationBusyError) throw await httpError(429, 'simulation_busy', { reason: error.reason })
      throw error
    }
    const progress = tryResolve<ProgressService>(ctx, 'progressService')
    for (const stale of created.abandoned) {
      await settleSimulationProgress(progress, stale, 'failed', 'abandoned')
    }
    const run = created.run
    if (!created.created) {
      return { runId: run.id, progressJobId: run.progressJobId ?? null, status: run.status, created: false }
    }
    let progressJobId: string | null = null
    const progressContext = { tenantId: scope.tenantId, organizationId: scope.organizationId, userId: input.userId }
    try {
      if (progress) {
        const { t } = await resolveTranslations()
        const job = await progress.createJob({
          jobType: SIMULATION_JOB_TYPE,
          name: t('insights.simulation.progress.name'),
          cancellable: false,
          meta: { runId: run.id },
        }, progressContext)
        progressJobId = job.id
        await attachProgressJob(em, run, job.id)
      }
      await enqueueSimulationSlice({ runId: run.id, tenantId: scope.tenantId, organizationId: scope.organizationId })
    } catch (error) {
      logger.error('[internal] Could not start a simulation run', { runId: run.id, err: error })
      getTelemetryRuntime()?.reportError(error, { module: 'insights', code: 'insights.simulation_start_failed' })
      const failed = await updateActiveSimulationRun(em, scope, run.id, null, { status: 'failed', errorCode: 'internal', completedAt: new Date(), resultJson: null })
      if (failed) await settleSimulationProgress(progress, failed, 'failed', 'internal')
      throw error
    }
    await ensureSimulationMaintenanceSchedule(ctx.container)
    return { runId: run.id, progressJobId, status: 'queued', created: true }
  },
  buildLog: async ({ input, result }) => {
    if (!result.created) return null
    const { t } = await resolveTranslations()
    const parsed = simulationRequestCommandSchema.parse(input)
    return {
      actionLabel: t('insights.simulation.audit.request'),
      resourceKind: SIMULATION_RUN_RESOURCE_KIND,
      resourceId: result.runId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      replayable: false,
      snapshotAfter: { id: result.runId, kind: parsed.kind, artifactId: parsed.artifactId, status: result.status },
    }
  },
}

/**
 * `insights.simulation.cancel`: the requester (or a `progress.manage` holder, `allowForeign`)
 * cancels a queued or running run of the organization; terminal runs answer 409. The ProgressJob is
 * marked cancelled too; a slice still running loses its compare-and-set write.
 */
const cancelSimulationCommand: CommandHandler<SimulationCancelCommandInput, SimulationCancelResult> = {
  id: SIMULATION_CANCEL_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = simulationCancelCommandSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = resolveEm(ctx)
    const run = await findSimulationRun(em, { scope, runId: input.runId, requesterUserId: input.allowForeign ? null : input.userId })
    if (!run) throw await httpError(404, 'run_not_found')
    if (!isActiveSimulationStatus(run.status)) throw await httpError(409, 'run_not_active')
    const saved = await updateActiveSimulationRun(em, scope, run.id, null, { status: 'cancelled', errorCode: null, completedAt: new Date(), resultJson: null })
    if (!saved) throw await httpError(409, 'run_not_active')
    await settleSimulationProgress(tryResolve<ProgressService>(ctx, 'progressService'), saved, 'cancelled', null)
    return { runId: saved.id, status: saved.status }
  },
  buildLog: async ({ input, result }) => {
    const { t } = await resolveTranslations()
    const parsed = simulationCancelCommandSchema.parse(input)
    return {
      actionLabel: t('insights.simulation.audit.cancel'),
      resourceKind: SIMULATION_RUN_RESOURCE_KIND,
      resourceId: result.runId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      replayable: false,
      snapshotAfter: { id: result.runId, status: result.status },
    }
  },
}

/**
 * `insights.simulation.decision.record` (S15, S16): appends `applied` or `discarded` for a
 * completed, unexpired run of the caller. For `applied` the server re-reads the live artifact
 * through the kind's `readArtifactVersion` and sets `verified` (written after the simulated version
 * AND fingerprint equal to the simulated proposal) — the client only says which decision it made.
 */
const recordDecisionCommand: CommandHandler<SimulationDecisionCommandInput, SimulationDecisionResult> = {
  id: SIMULATION_DECISION_COMMAND_ID,
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = simulationDecisionCommandSchema.parse(rawInput ?? {})
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = resolveEm(ctx)
    const run = await findSimulationRun(em, { scope, runId: input.runId, requesterUserId: input.userId })
    const registered = run ? getSimulationKind(run.kind) : null
    if (!run || !registered) throw await httpError(404, 'run_not_found')
    const hasFeatures = createFeatureCheck(ctx.container, input.userId, scope)
    if (!(await hasFeatures(storedRunFeatures(registered.definition, run.inputJson)))) throw await httpError(404, 'run_not_found')
    if (run.status !== 'completed') throw await httpError(409, 'run_not_completed')
    let verification = { verified: null as boolean | null, artifactId: run.artifactId ?? null, artifactUpdatedAtAfter: null as Date | null }
    if (input.decision === 'applied') {
      const parsed = registered.definition.inputSchema.safeParse(run.inputJson)
      const live = parsed.success
        ? await registered.definition.readArtifactVersion({ em, scope }, { artifactId: run.artifactId ?? null, input: parsed.data })
        : null
      verification = verifyAppliedDecision(
        { artifactId: run.artifactId ?? null, artifactVersion: run.artifactVersionJson ?? null, proposalFingerprint: run.proposalFingerprint },
        live,
      )
    }
    try {
      const decision = await insertSimulationDecision(em, {
        run,
        decision: input.decision,
        decidedByUserId: input.userId,
        artifactId: verification.artifactId,
        artifactUpdatedAtAfter: verification.artifactUpdatedAtAfter,
        verified: verification.verified,
      })
      return { id: decision.id, runId: run.id, decision: toSimulationDecisionView(decision) }
    } catch (error) {
      if (error instanceof SimulationDecisionExistsError) throw await httpError(409, 'decision_exists')
      throw error
    }
  },
  buildLog: async ({ input, result }) => {
    const { t } = await resolveTranslations()
    const parsed = simulationDecisionCommandSchema.parse(input)
    return {
      actionLabel: t('insights.simulation.audit.decision'),
      resourceKind: SIMULATION_DECISION_RESOURCE_KIND,
      resourceId: result.id,
      parentResourceKind: SIMULATION_RUN_RESOURCE_KIND,
      parentResourceId: result.runId,
      tenantId: parsed.tenantId,
      organizationId: parsed.organizationId,
      replayable: false,
      snapshotAfter: {
        id: result.id,
        runId: result.runId,
        decision: result.decision.decision,
        verified: result.decision.verified,
        artifactId: result.decision.artifactId,
      },
    }
  },
}

registerCommand(requestSimulationCommand)
registerCommand(cancelSimulationCommand)
registerCommand(recordDecisionCommand)

export const simulationCommands = [requestSimulationCommand, cancelSimulationCommand, recordDecisionCommand]

export { requestSimulationCommand, cancelSimulationCommand, recordDecisionCommand }
