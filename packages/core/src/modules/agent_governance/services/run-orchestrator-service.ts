import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AgentGovernanceApprovalTask,
  AgentGovernanceRiskBand,
  AgentGovernanceRun,
  AgentGovernanceRunStep,
  type AgentActionClass,
  type AgentAutonomyMode,
  type AgentRiskLevel,
  type AgentRunStatus,
} from '../data/entities'
import type { RunRerouteInput, RunStartInput } from '../data/validators'
import type { TelemetryService } from './telemetry-service'
import type { HarnessAdapterService } from './harness-adapter-service'
import type { SkillLifecycleService } from './skill-lifecycle-service'
import { PolicyViolationError, toCrudHttpError } from '../lib/domain-errors'

export type StartRunResult = {
  run: AgentGovernanceRun
  approvalTaskId: string | null
  checkpointReasons: string[]
  telemetryEventId: string | null
  telemetryRepairRequired: boolean
}

export type TransitionRunResult = {
  run: AgentGovernanceRun
  telemetryEventId: string | null
  telemetryRepairRequired: boolean
}

export type RerouteRunResult = {
  run: AgentGovernanceRun
  approvalTaskId: string | null
  checkpointReasons: string[]
  telemetryEventId: string | null
  telemetryRepairRequired: boolean
}

type RunOrchestratorDeps = {
  em: EntityManager
  telemetryService: TelemetryService
  harnessAdapterService?: Pick<HarnessAdapterService, 'getActiveProviderId'>
  skillLifecycleService?: Pick<SkillLifecycleService, 'listActiveGuidance'>
}

type TransitionRunOptions = {
  reason?: string | null
  actorUserId?: string | null
  controlPath?: 'auto' | 'checkpoint' | 'override' | 'rejected'
}

type RunControlPolicyInput = {
  autonomyMode: AgentAutonomyMode
  actionClass: AgentActionClass
  riskLevel?: AgentRiskLevel | null
  requiresApproval: boolean
  failClosed: boolean
}

type RunControlPolicyDecision = {
  requiresCheckpoint: boolean
  checkpointReasons: string[]
  telemetryDurability: 'fail_closed' | 'fail_soft'
}

const allowedTransitions: Record<AgentRunStatus, AgentRunStatus[]> = {
  queued: ['running', 'checkpoint', 'terminated', 'failed'],
  running: ['checkpoint', 'paused', 'failed', 'completed', 'terminated'],
  checkpoint: ['running', 'terminated', 'failed'],
  paused: ['running', 'terminated', 'failed'],
  failed: [],
  completed: [],
  terminated: [],
}

const irreversibleActionPattern = /(^|[_:\-\s])(delete|terminate|close|approve|ship|invoice|payment|refund|transfer|write_final)([_:\-\s]|$)/i

const readActionPattern = /(^|[_:\-\s])(read|view|list|inspect|search|query|fetch)([_:\-\s]|$)/i

const irreversibleRiskLevels = new Set<AgentRiskLevel>(['high', 'critical'])
const strictCheckpointReasons = new Set([
  'risk_band_requires_approval',
  'irreversible_action_requires_checkpoint',
])

function resolveHarnessProviderId(deps: RunOrchestratorDeps): string {
  return deps.harnessAdapterService?.getActiveProviderId() ?? 'open_mercato'
}

export function resolveActionClass(actionType: string, explicitClass?: AgentActionClass | null): AgentActionClass {
  if (explicitClass) return explicitClass
  if (readActionPattern.test(actionType)) return 'read'
  if (irreversibleActionPattern.test(actionType)) return 'irreversible'
  return 'write'
}

export function evaluateRunControlPolicy(input: RunControlPolicyInput): RunControlPolicyDecision {
  const checkpointReasons: string[] = []

  if (input.requiresApproval) {
    checkpointReasons.push('risk_band_requires_approval')
  }

  if (input.autonomyMode === 'propose') {
    checkpointReasons.push('autonomy_mode_propose')
  }

  if (input.autonomyMode === 'assist' && input.actionClass !== 'read') {
    checkpointReasons.push('assist_mode_write_requires_checkpoint')
  }

  if (
    input.actionClass === 'irreversible' &&
    ((input.riskLevel && irreversibleRiskLevels.has(input.riskLevel)) || input.failClosed)
  ) {
    checkpointReasons.push('irreversible_action_requires_checkpoint')
  }

  const telemetryDurability: 'fail_closed' | 'fail_soft' =
    input.failClosed ||
    input.riskLevel === 'critical' ||
    input.actionClass === 'irreversible'
      ? 'fail_closed'
      : 'fail_soft'

  return {
    requiresCheckpoint: checkpointReasons.length > 0,
    checkpointReasons,
    telemetryDurability,
  }
}

type CheckpointThrottleInput = {
  actionClass: AgentActionClass
  riskLevel?: AgentRiskLevel | null
  checkpointReasons: string[]
  recentCheckpointCount: number
}

export function shouldThrottleCheckpoint(input: CheckpointThrottleInput): boolean {
  const thresholdRaw = Number.parseInt(process.env.AGENT_GOVERNANCE_CHECKPOINT_THROTTLE_THRESHOLD ?? '50', 10)
  const threshold = Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : 50

  if (input.recentCheckpointCount < threshold) {
    return false
  }

  if (input.actionClass === 'irreversible') {
    return false
  }

  if (input.riskLevel === 'high' || input.riskLevel === 'critical') {
    return false
  }

  return input.checkpointReasons.every((reason) => !strictCheckpointReasons.has(reason))
}

async function nextRunStepSequenceNo(em: EntityManager, run: AgentGovernanceRun): Promise<number> {
  const lastStep = await findOneWithDecryption(
    em,
    AgentGovernanceRunStep,
    {
      tenantId: run.tenantId,
      organizationId: run.organizationId,
      run: run.id,
    },
    { orderBy: { sequenceNo: 'DESC' } },
    { tenantId: run.tenantId, organizationId: run.organizationId },
  )
  return (lastStep?.sequenceNo ?? 0) + 1
}

async function appendAuditStep(
  em: EntityManager,
  run: AgentGovernanceRun,
  actionType: string,
  actorUserId: string | null,
  inputJson: Record<string, unknown>,
): Promise<void> {
  const now = new Date()
  const step = em.create(AgentGovernanceRunStep, {
    tenantId: run.tenantId,
    organizationId: run.organizationId,
    run,
    sequenceNo: await nextRunStepSequenceNo(em, run),
    actionType,
    toolName: 'operator',
    isIrreversible: false,
    status: 'completed',
    inputJson: {
      ...inputJson,
      actorUserId,
    },
    outputJson: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(step)
}

async function createCheckpointApprovalTask(
  em: EntityManager,
  run: AgentGovernanceRun,
  reason: string,
  actorUserId: string | null,
): Promise<AgentGovernanceApprovalTask> {
  const now = new Date()
  const approvalTask = em.create(AgentGovernanceApprovalTask, {
    tenantId: run.tenantId,
    organizationId: run.organizationId,
    run,
    status: 'pending',
    requestedByUserId: actorUserId,
    reason,
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  em.persist(approvalTask)
  return approvalTask
}

export function createRunOrchestratorService(deps: RunOrchestratorDeps) {
  async function startRun(input: RunStartInput, actorUserId: string | null): Promise<StartRunResult> {
    const now = new Date()
    const run = deps.em.create(AgentGovernanceRun, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      playbookId: input.playbookId ?? null,
      policyId: input.policyId ?? null,
      riskBandId: input.riskBandId ?? null,
      status: 'queued',
      autonomyMode: input.autonomyMode,
      actionType: input.actionType,
      targetEntity: input.targetEntity,
      targetId: input.targetId ?? null,
      inputContext: input.inputContext ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    })

    deps.em.persist(run)
    await deps.em.flush()

    const riskBand = input.riskBandId
      ? await findOneWithDecryption(
          deps.em,
          AgentGovernanceRiskBand,
          {
            id: input.riskBandId,
            tenantId: input.tenantId,
            organizationId: input.organizationId,
            deletedAt: null,
          },
          undefined,
          { tenantId: input.tenantId, organizationId: input.organizationId },
        )
      : null

    const actionClass = resolveActionClass(input.actionType, input.actionClass)
    const runControlPolicy = evaluateRunControlPolicy({
      autonomyMode: input.autonomyMode,
      actionClass,
      riskLevel: riskBand?.riskLevel ?? null,
      requiresApproval: input.requireApproval === true || riskBand?.requiresApproval === true,
      failClosed: riskBand?.failClosed === true,
    })

    const activeSkillGuidance = deps.skillLifecycleService
      ? await deps.skillLifecycleService.listActiveGuidance({
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          actionType: input.actionType,
          targetEntity: input.targetEntity,
          targetId: input.targetId ?? null,
          limit: 8,
        })
      : []

    if (activeSkillGuidance.length > 0) {
      run.inputContext = {
        ...(run.inputContext ?? {}),
        activeSkills: activeSkillGuidance.map((skill) => ({
          skillId: skill.skillId,
          name: skill.name,
          summary: skill.summary,
          confidence: skill.confidence,
        })),
      }
    }

    let checkpointReasons = [...runControlPolicy.checkpointReasons]
    let requiresCheckpoint = runControlPolicy.requiresCheckpoint
    let checkpointThrottled = false

    if (requiresCheckpoint) {
      const throttleWindowMinutesRaw = Number.parseInt(process.env.AGENT_GOVERNANCE_CHECKPOINT_THROTTLE_WINDOW_MIN ?? '60', 10)
      const throttleWindowMinutes = Number.isFinite(throttleWindowMinutesRaw) && throttleWindowMinutesRaw > 0
        ? throttleWindowMinutesRaw
        : 60
      const windowStart = new Date(Date.now() - throttleWindowMinutes * 60_000)
      const recentCheckpointCount = await deps.em.count(AgentGovernanceRun, {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        status: 'checkpoint',
        createdAt: { $gte: windowStart },
      })

      checkpointThrottled = shouldThrottleCheckpoint({
        actionClass,
        riskLevel: riskBand?.riskLevel ?? null,
        checkpointReasons,
        recentCheckpointCount,
      })

      if (checkpointThrottled) {
        requiresCheckpoint = false
        checkpointReasons = [...checkpointReasons, 'checkpoint_throttled']
      }
    }

    run.status = requiresCheckpoint ? 'checkpoint' : 'running'
    run.updatedAt = new Date()

    let approvalTaskId: string | null = null
    if (requiresCheckpoint) {
      const approvalTask = await createCheckpointApprovalTask(
        deps.em,
        run,
        `Checkpoint required: ${checkpointReasons.join(', ')}`,
        actorUserId,
      )
      approvalTaskId = approvalTask.id
    }

    await appendAuditStep(deps.em, run, 'run.start', actorUserId, {
      status: run.status,
      actionClass,
      checkpointReasons,
      approvalTaskId,
      checkpointThrottled,
    })

    const retrievalBundleId =
      typeof input.inputContext?.retrievalBundleId === 'string'
        ? input.inputContext.retrievalBundleId
        : null
    const retrievalFallbackUsed = input.inputContext?.retrievalFallbackUsed === true
    const retrievalSliceCount =
      typeof input.inputContext?.retrievalSliceCount === 'number'
        ? input.inputContext.retrievalSliceCount
        : Array.isArray(input.sourceRefs)
          ? input.sourceRefs.length
          : 0

    const telemetrySourceRefs = [...new Set([...(input.sourceRefs ?? []), ...activeSkillGuidance.map((skill) => skill.sourceRef)])]

    const telemetryResult = await deps.telemetryService.recordDecisionWithDurability(
      {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        runId: run.id,
        actionType: input.actionType,
        targetEntity: input.targetEntity,
        targetId: input.targetId ?? null,
        sourceRefs: telemetrySourceRefs,
        policyId: input.policyId ?? null,
        riskBandId: input.riskBandId ?? null,
        riskScore: input.riskScore ?? null,
        controlPath: runControlPolicy.requiresCheckpoint ? 'checkpoint' : 'auto',
        approverIds: [],
        exceptionIds: [],
        writeSet: {
          runStatus: run.status,
          actionClass,
          checkpointReasons,
          checkpointThrottled,
          retrievalBundleId,
          retrievalFallbackUsed,
          retrievalSliceCount,
          activeSkillRefs: activeSkillGuidance.map((skill) => skill.sourceRef),
          activeSkillCount: activeSkillGuidance.length,
        },
        status: 'success',
        harnessProvider: resolveHarnessProviderId(deps),
      },
      {
        durability: runControlPolicy.telemetryDurability,
        repairCode: 'RUN_START_TELEMETRY_REPAIR_REQUIRED',
        repairMarker: {
          runStatus: run.status,
          actionClass,
          checkpointThrottled,
        },
      },
    )

    await deps.em.flush()

    return {
      run,
      approvalTaskId,
      checkpointReasons,
      telemetryEventId: telemetryResult.eventId,
      telemetryRepairRequired: telemetryResult.repairRequired,
    }
  }

  async function transitionRun(
    run: AgentGovernanceRun,
    nextStatus: AgentRunStatus,
    options?: TransitionRunOptions,
  ): Promise<TransitionRunResult> {
    const allowed = allowedTransitions[run.status] ?? []
    if (!allowed.includes(nextStatus)) {
      throw toCrudHttpError(
        new PolicyViolationError(`Run cannot move from ${run.status} to ${nextStatus}.`, 'RUN_TRANSITION_INVALID'),
      )
    }

    const previousStatus = run.status
    run.status = nextStatus
    run.updatedAt = new Date()

    if (nextStatus === 'paused') {
      run.pauseReason = options?.reason ?? 'Paused by operator'
    }

    if (nextStatus === 'terminated') {
      run.terminatedAt = new Date()
      run.pauseReason = options?.reason ?? run.pauseReason ?? null
    }

    if (nextStatus === 'failed') {
      run.failedAt = new Date()
    }

    if (nextStatus === 'completed') {
      run.completedAt = new Date()
    }

    await appendAuditStep(deps.em, run, `run.transition.${nextStatus}`, options?.actorUserId ?? null, {
      previousStatus,
      nextStatus,
      reason: options?.reason ?? null,
    })

    await deps.em.flush()

    const riskBand = run.riskBandId
      ? await findOneWithDecryption(
          deps.em,
          AgentGovernanceRiskBand,
          {
            id: run.riskBandId,
            tenantId: run.tenantId,
            organizationId: run.organizationId,
            deletedAt: null,
          },
          undefined,
          { tenantId: run.tenantId, organizationId: run.organizationId },
        )
      : null

    const actionClass = resolveActionClass(run.actionType)
    const runControlPolicy = evaluateRunControlPolicy({
      autonomyMode: run.autonomyMode,
      actionClass,
      riskLevel: riskBand?.riskLevel ?? null,
      requiresApproval: riskBand?.requiresApproval === true,
      failClosed: riskBand?.failClosed === true,
    })

    const telemetryResult = await deps.telemetryService.recordDecisionWithDurability(
      {
        tenantId: run.tenantId,
        organizationId: run.organizationId,
        runId: run.id,
        actionType: run.actionType,
        targetEntity: run.targetEntity,
        targetId: run.targetId ?? null,
        sourceRefs: [],
        policyId: run.policyId ?? null,
        riskBandId: run.riskBandId ?? null,
        riskScore: null,
        controlPath: options?.controlPath ?? (nextStatus === 'terminated' ? 'override' : 'auto'),
        approverIds: options?.actorUserId ? [options.actorUserId] : [],
        exceptionIds: [],
        writeSet: { runStatus: nextStatus, reason: options?.reason ?? null },
        status: 'success',
        harnessProvider: resolveHarnessProviderId(deps),
      },
      {
        durability: runControlPolicy.telemetryDurability,
        repairCode: 'RUN_TRANSITION_TELEMETRY_REPAIR_REQUIRED',
        repairMarker: {
          runStatus: nextStatus,
          previousStatus,
        },
      },
    )

    return {
      run,
      telemetryEventId: telemetryResult.eventId,
      telemetryRepairRequired: telemetryResult.repairRequired,
    }
  }

  async function rerouteRun(
    run: AgentGovernanceRun,
    input: RunRerouteInput,
    actorUserId: string | null,
  ): Promise<RerouteRunResult> {
    if (run.status === 'failed' || run.status === 'completed' || run.status === 'terminated') {
      throw toCrudHttpError(new PolicyViolationError('Terminal runs cannot be rerouted.', 'RUN_REROUTE_BLOCKED'))
    }

    const previousPlaybookId = run.playbookId ?? null
    const previousPolicyId = run.policyId ?? null
    const previousRiskBandId = run.riskBandId ?? null

    if (input.playbookId !== undefined) run.playbookId = input.playbookId
    if (input.policyId !== undefined) run.policyId = input.policyId
    if (input.riskBandId !== undefined) run.riskBandId = input.riskBandId
    run.updatedAt = new Date()

    const riskBand = run.riskBandId
      ? await findOneWithDecryption(
          deps.em,
          AgentGovernanceRiskBand,
          {
            id: run.riskBandId,
            tenantId: run.tenantId,
            organizationId: run.organizationId,
            deletedAt: null,
          },
          undefined,
          { tenantId: run.tenantId, organizationId: run.organizationId },
        )
      : null

    const actionClass = resolveActionClass(run.actionType)
    const runControlPolicy = evaluateRunControlPolicy({
      autonomyMode: run.autonomyMode,
      actionClass,
      riskLevel: riskBand?.riskLevel ?? null,
      requiresApproval: riskBand?.requiresApproval === true,
      failClosed: riskBand?.failClosed === true,
    })

    let approvalTaskId: string | null = null
    if (runControlPolicy.requiresCheckpoint) {
      run.status = 'checkpoint'

      const pendingApproval = await findOneWithDecryption(
        deps.em,
        AgentGovernanceApprovalTask,
        {
          tenantId: run.tenantId,
          organizationId: run.organizationId,
          run: run.id,
          status: 'pending',
        },
        undefined,
        { tenantId: run.tenantId, organizationId: run.organizationId },
      )

      if (!pendingApproval) {
        const approvalTask = await createCheckpointApprovalTask(
          deps.em,
          run,
          `Checkpoint required after reroute: ${runControlPolicy.checkpointReasons.join(', ')}`,
          actorUserId,
        )
        approvalTaskId = approvalTask.id
      } else {
        approvalTaskId = pendingApproval.id
      }
    } else if (run.status === 'checkpoint') {
      run.status = 'running'
    }

    await appendAuditStep(deps.em, run, 'run.reroute', actorUserId, {
      previousPlaybookId,
      nextPlaybookId: run.playbookId ?? null,
      previousPolicyId,
      nextPolicyId: run.policyId ?? null,
      previousRiskBandId,
      nextRiskBandId: run.riskBandId ?? null,
      reason: input.reason ?? null,
      checkpointReasons: runControlPolicy.checkpointReasons,
      approvalTaskId,
    })

    await deps.em.flush()

    const telemetryResult = await deps.telemetryService.recordDecisionWithDurability(
      {
        tenantId: run.tenantId,
        organizationId: run.organizationId,
        runId: run.id,
        actionType: run.actionType,
        targetEntity: run.targetEntity,
        targetId: run.targetId ?? null,
        sourceRefs: [],
        policyId: run.policyId ?? null,
        riskBandId: run.riskBandId ?? null,
        riskScore: null,
        controlPath: 'override',
        approverIds: actorUserId ? [actorUserId] : [],
        exceptionIds: [],
        writeSet: {
          previousPlaybookId,
          nextPlaybookId: run.playbookId ?? null,
          previousPolicyId,
          nextPolicyId: run.policyId ?? null,
          previousRiskBandId,
          nextRiskBandId: run.riskBandId ?? null,
          runStatus: run.status,
          checkpointReasons: runControlPolicy.checkpointReasons,
        },
        status: 'success',
        harnessProvider: resolveHarnessProviderId(deps),
      },
      {
        durability: runControlPolicy.telemetryDurability,
        repairCode: 'RUN_REROUTE_TELEMETRY_REPAIR_REQUIRED',
        repairMarker: {
          runStatus: run.status,
        },
      },
    )

    return {
      run,
      approvalTaskId,
      checkpointReasons: runControlPolicy.checkpointReasons,
      telemetryEventId: telemetryResult.eventId,
      telemetryRepairRequired: telemetryResult.repairRequired,
    }
  }

  return {
    startRun,
    transitionRun,
    rerouteRun,
  }
}

export type RunOrchestratorService = ReturnType<typeof createRunOrchestratorService>
