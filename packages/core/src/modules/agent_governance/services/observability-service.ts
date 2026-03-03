import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AgentGovernanceApprovalTask,
  AgentGovernanceDecisionEvent,
  AgentGovernanceDecisionWhyLink,
  AgentGovernanceRun,
  AgentGovernanceSkill,
  AgentGovernanceSkillVersion,
  type AgentRunStatus,
  type AgentSkillStatus,
} from '../data/entities'

type Scope = {
  tenantId: string
  organizationId: string
}

type StatusCounts<T extends string> = Record<T, number>

const runStatuses: AgentRunStatus[] = ['queued', 'running', 'checkpoint', 'paused', 'failed', 'completed', 'terminated']
const skillStatuses: AgentSkillStatus[] = ['draft', 'validated', 'active', 'deprecated']

async function countStatuses<TStatus extends string>(
  em: EntityManager,
  entity: typeof AgentGovernanceRun | typeof AgentGovernanceSkill,
  scope: Scope,
  statuses: TStatus[],
): Promise<StatusCounts<TStatus>> {
  const output = {} as StatusCounts<TStatus>
  for (const status of statuses) {
    const count = await em.count(entity, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      status,
      ...(entity === AgentGovernanceSkill ? { deletedAt: null } : {}),
    })
    output[status] = count
  }

  return output
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  const total = values.reduce((acc, value) => acc + value, 0)
  return total / values.length
}

function isRunTerminal(status: AgentRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'terminated'
}

function hasActiveSkills(inputContext: Record<string, unknown> | null | undefined): boolean {
  if (!inputContext || typeof inputContext !== 'object') return false
  const activeSkills = (inputContext as Record<string, unknown>).activeSkills
  return Array.isArray(activeSkills) && activeSkills.length > 0
}

function successRate(runs: AgentGovernanceRun[]): number {
  if (runs.length === 0) return 0
  const successful = runs.filter((run) => run.status === 'completed').length
  return successful / runs.length
}

function computeAlertRouting(input: {
  failedRuns24h: number
  telemetryRepairSignals24h: number
  checkpointVolume24h: number
}): {
  severity: 'none' | 'low' | 'medium' | 'high'
  route: 'none' | 'governance_admins' | 'operators'
  digestRecommended: boolean
  reasons: string[]
} {
  const reasons: string[] = []
  let severity: 'none' | 'low' | 'medium' | 'high' = 'none'
  let route: 'none' | 'governance_admins' | 'operators' = 'none'
  let digestRecommended = false

  if (input.failedRuns24h >= 5) {
    severity = 'high'
    route = 'operators'
    reasons.push('failed_runs_spike')
  }

  if (input.telemetryRepairSignals24h >= 10) {
    severity = 'high'
    route = 'operators'
    reasons.push('telemetry_repair_spike')
  }

  if (severity !== 'high' && input.failedRuns24h >= 2) {
    severity = 'medium'
    route = 'governance_admins'
    reasons.push('failed_runs_increase')
  }

  if (severity !== 'high' && input.telemetryRepairSignals24h >= 3) {
    severity = 'medium'
    route = 'governance_admins'
    reasons.push('telemetry_repairs_increase')
  }

  if (input.checkpointVolume24h >= 100) {
    if (severity === 'none') {
      severity = 'low'
      route = 'governance_admins'
    }
    digestRecommended = severity !== 'high'
    reasons.push('checkpoint_volume_high')
  }

  return {
    severity,
    route,
    digestRecommended,
    reasons,
  }
}

export function createObservabilityService(deps: { em: EntityManager }) {
  async function getMetrics(scope: Scope): Promise<{
    governance: {
      runsTotal: number
      runsByStatus: StatusCounts<AgentRunStatus>
      pendingApprovals: number
      checkpointRate: number
      interventionLatencyMs: number
    }
    memory: {
      decisionsTotal: number
      traceCompletenessRate: number
      precedentWhyLinks: number
      precedentUsefulnessRate: number
    }
    operations: {
      failedRuns24h: number
      telemetryRepairSignals24h: number
      checkpointVolume24h: number
      alertRouting: {
        severity: 'none' | 'low' | 'medium' | 'high'
        route: 'none' | 'governance_admins' | 'operators'
        digestRecommended: boolean
        reasons: string[]
      }
    }
    learning: {
      skillsTotal: number
      skillsByStatus: StatusCounts<AgentSkillStatus>
      promotedSkills30d: number
      skillGuidanceImpact30d: {
        terminalRunsWithSkills: number
        terminalRunsWithoutSkills: number
        successRateWithSkills: number
        successRateWithoutSkills: number
        successRateDelta: number
      }
    }
  }> {
    const em = deps.em

    const [
      runsTotal,
      runsByStatus,
      pendingApprovals,
      decisionsTotal,
      precedentWhyLinks,
      skillsTotal,
      skillsByStatus,
    ] = await Promise.all([
      em.count(AgentGovernanceRun, { tenantId: scope.tenantId, organizationId: scope.organizationId }),
      countStatuses(em, AgentGovernanceRun, scope, runStatuses),
      em.count(AgentGovernanceApprovalTask, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        status: 'pending',
      }),
      em.count(AgentGovernanceDecisionEvent, { tenantId: scope.tenantId, organizationId: scope.organizationId }),
      em.count(AgentGovernanceDecisionWhyLink, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        reasonType: 'precedent',
      }),
      em.count(AgentGovernanceSkill, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      }),
      countStatuses(em, AgentGovernanceSkill, scope, skillStatuses),
    ])

    const reviewedApprovals = await findWithDecryption(
      em,
      AgentGovernanceApprovalTask,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        reviewedAt: { $ne: null },
      },
      {
        orderBy: { reviewedAt: 'DESC' },
        limit: 500,
      },
      scope,
    )

    const approvalLatencies = reviewedApprovals
      .map((task) => {
        if (!task.reviewedAt || !task.requestedAt) return null
        return task.reviewedAt.getTime() - task.requestedAt.getTime()
      })
      .filter((value): value is number => typeof value === 'number' && value >= 0)

    const sampledDecisions = await findWithDecryption(
      em,
      AgentGovernanceDecisionEvent,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      {
        orderBy: { createdAt: 'DESC' },
        limit: 500,
      },
      scope,
    )

    const completeDecisions = sampledDecisions.filter((decision) => {
      const hasEvidence = Array.isArray(decision.inputEvidence) && decision.inputEvidence.length > 0
      const hasWriteSet = Boolean(decision.writeSet && Object.keys(decision.writeSet).length > 0)
      return hasEvidence && hasWriteSet
    }).length

    const traceCompletenessRate = sampledDecisions.length > 0 ? completeDecisions / sampledDecisions.length : 0

    const checkpointRate = runsTotal > 0 ? (runsByStatus.checkpoint + runsByStatus.paused) / runsTotal : 0

    const now = Date.now()
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000)
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)

    const [failedRuns24h, telemetryRepairSignals24h, checkpointVolume24h, promotedSkills30d] = await Promise.all([
      em.count(AgentGovernanceRun, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        status: 'failed',
        updatedAt: { $gte: dayAgo },
      }),
      em.count(AgentGovernanceDecisionEvent, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        status: 'failed',
        errorCode: { $like: '%REPAIR_REQUIRED%' },
        createdAt: { $gte: dayAgo },
      }),
      em.count(AgentGovernanceRun, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        status: 'checkpoint',
        createdAt: { $gte: dayAgo },
      }),
      em.count(AgentGovernanceSkillVersion, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        createdAt: { $gte: monthAgo },
      }),
    ])

    const recentRuns = await findWithDecryption(
      em,
      AgentGovernanceRun,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        updatedAt: { $gte: monthAgo },
      },
      {
        orderBy: { updatedAt: 'DESC' },
        limit: 1000,
      },
      scope,
    )

    const terminalRuns = recentRuns.filter((run) => isRunTerminal(run.status))
    const terminalRunsWithSkills = terminalRuns.filter((run) => hasActiveSkills(run.inputContext))
    const terminalRunsWithoutSkills = terminalRuns.filter((run) => !hasActiveSkills(run.inputContext))
    const successRateWithSkills = successRate(terminalRunsWithSkills)
    const successRateWithoutSkills = successRate(terminalRunsWithoutSkills)
    const successRateDelta = successRateWithSkills - successRateWithoutSkills

    const precedentUsefulnessRate = decisionsTotal > 0 ? precedentWhyLinks / decisionsTotal : 0
    const alertRouting = computeAlertRouting({
      failedRuns24h,
      telemetryRepairSignals24h,
      checkpointVolume24h,
    })

    return {
      governance: {
        runsTotal,
        runsByStatus,
        pendingApprovals,
        checkpointRate,
        interventionLatencyMs: average(approvalLatencies),
      },
      memory: {
        decisionsTotal,
        traceCompletenessRate,
        precedentWhyLinks,
        precedentUsefulnessRate,
      },
      operations: {
        failedRuns24h,
        telemetryRepairSignals24h,
        checkpointVolume24h,
        alertRouting,
      },
      learning: {
        skillsTotal,
        skillsByStatus,
        promotedSkills30d,
        skillGuidanceImpact30d: {
          terminalRunsWithSkills: terminalRunsWithSkills.length,
          terminalRunsWithoutSkills: terminalRunsWithoutSkills.length,
          successRateWithSkills,
          successRateWithoutSkills,
          successRateDelta,
        },
      },
    }
  }

  return {
    getMetrics,
  }
}

export type ObservabilityService = ReturnType<typeof createObservabilityService>
