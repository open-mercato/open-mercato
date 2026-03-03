import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentGovernancePlaybook } from '../data/entities'
import {
  agentPlaybookCreateSchema,
  agentPlaybookUpdateSchema,
  type AgentPlaybookCreateInput,
  type AgentPlaybookUpdateInput,
} from '../data/validators'
import { emitAgentGovernanceEvent } from '../events'
import { ensureRecordScope, ensureTenantScope, recordCommandDecision, resolveHarnessProvider, scopeFromContext } from './shared'

type DeleteInput = { id: string }

type SchedulerServiceLike = {
  register: (input: {
    id: string
    name: string
    description?: string
    scopeType: 'organization'
    organizationId: string
    tenantId: string
    scheduleType: 'cron'
    scheduleValue: string
    timezone?: string
    targetType: 'queue'
    targetQueue: string
    targetPayload: Record<string, unknown>
    requireFeature?: string
    sourceType: 'module'
    sourceModule: string
    isEnabled: boolean
  }) => Promise<void>
  unregister: (scheduleId: string) => Promise<void>
}

function buildPlaybookScheduleId(playbookId: string): string {
  return `agent_governance:playbook:${playbookId}`
}

function resolveSchedulerService(ctx: Parameters<typeof recordCommandDecision>[0]): SchedulerServiceLike | null {
  try {
    return ctx.container.resolve('schedulerService') as SchedulerServiceLike
  } catch {
    return null
  }
}

async function syncPlaybookSchedule(
  ctx: Parameters<typeof recordCommandDecision>[0],
  playbook: AgentGovernancePlaybook,
): Promise<{ managed: boolean; status: 'registered' | 'unregistered' | 'skipped'; scheduleId: string; error: string | null }> {
  const schedulerService = resolveSchedulerService(ctx)
  const scheduleId = buildPlaybookScheduleId(playbook.id)

  if (!schedulerService) {
    return {
      managed: false,
      status: 'skipped',
      scheduleId,
      error: null,
    }
  }

  const shouldSchedule = playbook.triggerType === 'scheduled' && Boolean(playbook.scheduleCron) && playbook.isActive

  try {
    if (!shouldSchedule) {
      await schedulerService.unregister(scheduleId)
      return {
        managed: true,
        status: 'unregistered',
        scheduleId,
        error: null,
      }
    }

    await schedulerService.register({
      id: scheduleId,
      name: `Agent Governance: ${playbook.name}`,
      description: playbook.description ?? `Scheduled execution for playbook ${playbook.id}`,
      scopeType: 'organization',
      organizationId: playbook.organizationId,
      tenantId: playbook.tenantId,
      scheduleType: 'cron',
      scheduleValue: playbook.scheduleCron ?? '0 * * * *',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'agent-governance-dispatch',
      targetPayload: {
        playbookId: playbook.id,
        policyId: playbook.policyId ?? null,
        riskBandId: playbook.riskBandId ?? null,
        autonomyMode: 'propose',
        actionClass: 'write',
        actionType: 'playbook.execute',
        targetEntity: 'agent_governance_playbook',
        targetId: playbook.id,
        inputContext: {
          trigger: 'schedule',
          scheduleId,
          playbookName: playbook.name,
        },
      },
      requireFeature: 'agent_governance.runs.manage',
      sourceType: 'module',
      sourceModule: 'agent_governance',
      isEnabled: true,
    })

    return {
      managed: true,
      status: 'registered',
      scheduleId,
      error: null,
    }
  } catch (error) {
    return {
      managed: true,
      status: shouldSchedule ? 'registered' : 'unregistered',
      scheduleId,
      error: error instanceof Error ? error.message : 'Scheduler sync failed',
    }
  }
}

const createPlaybookCommand: CommandHandler<AgentPlaybookCreateInput, { playbookId: string }> = {
  id: 'agent_governance.playbooks.create',
  async execute(rawInput, ctx) {
    const input = agentPlaybookCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureRecordScope(ctx, input.tenantId, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()

    const playbook = em.create(AgentGovernancePlaybook, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      policyId: input.policyId ?? null,
      riskBandId: input.riskBandId ?? null,
      triggerType: input.triggerType,
      scheduleCron: input.scheduleCron ?? null,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(playbook)
    await em.flush()
    const scheduleSync = await syncPlaybookSchedule(ctx, playbook)

    await recordCommandDecision(
      ctx,
      {
        tenantId: playbook.tenantId,
        organizationId: playbook.organizationId,
        runId: null,
        stepId: 'agent_governance.playbooks.create',
        actionType: 'playbook.create',
        targetEntity: 'agent_governance_playbook',
        targetId: playbook.id,
        sourceRefs: [],
        policyId: playbook.policyId ?? null,
        riskBandId: playbook.riskBandId ?? null,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: {
          operation: 'create',
          triggerType: playbook.triggerType,
          scheduleCron: playbook.scheduleCron ?? null,
          isActive: playbook.isActive,
          scheduleSync,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_soft',
        repairCode: 'PLAYBOOK_CREATE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.playbook.created', {
      id: playbook.id,
      tenantId: playbook.tenantId,
      organizationId: playbook.organizationId,
    })

    return { playbookId: playbook.id }
  },
}

const updatePlaybookCommand: CommandHandler<AgentPlaybookUpdateInput, { playbookId: string }> = {
  id: 'agent_governance.playbooks.update',
  async execute(rawInput, ctx) {
    const input = agentPlaybookUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const playbook = await findOneWithDecryption(
      em,
      AgentGovernancePlaybook,
      { id: input.id, deletedAt: null },
      undefined,
      scopeFromContext(ctx),
    )
    if (!playbook) throw new CrudHttpError(404, { error: 'Playbook not found.' })

    ensureRecordScope(ctx, playbook.tenantId, playbook.organizationId)

    if (input.name !== undefined) playbook.name = input.name
    if (input.description !== undefined) playbook.description = input.description ?? null
    if (input.policyId !== undefined) playbook.policyId = input.policyId ?? null
    if (input.riskBandId !== undefined) playbook.riskBandId = input.riskBandId ?? null
    if (input.triggerType !== undefined) playbook.triggerType = input.triggerType
    if (input.scheduleCron !== undefined) playbook.scheduleCron = input.scheduleCron ?? null
    if (input.isActive !== undefined) playbook.isActive = input.isActive
    playbook.updatedAt = new Date()
    await em.flush()
    const scheduleSync = await syncPlaybookSchedule(ctx, playbook)

    await recordCommandDecision(
      ctx,
      {
        tenantId: playbook.tenantId,
        organizationId: playbook.organizationId,
        runId: null,
        stepId: 'agent_governance.playbooks.update',
        actionType: 'playbook.update',
        targetEntity: 'agent_governance_playbook',
        targetId: playbook.id,
        sourceRefs: [],
        policyId: playbook.policyId ?? null,
        riskBandId: playbook.riskBandId ?? null,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: {
          operation: 'update',
          triggerType: playbook.triggerType,
          scheduleCron: playbook.scheduleCron ?? null,
          isActive: playbook.isActive,
          scheduleSync,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_soft',
        repairCode: 'PLAYBOOK_UPDATE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.playbook.updated', {
      id: playbook.id,
      tenantId: playbook.tenantId,
      organizationId: playbook.organizationId,
    })

    return { playbookId: playbook.id }
  },
}

const deletePlaybookCommand: CommandHandler<DeleteInput, { playbookId: string }> = {
  id: 'agent_governance.playbooks.delete',
  async execute(rawInput, ctx) {
    if (!rawInput || typeof rawInput.id !== 'string') {
      throw new CrudHttpError(400, { error: 'Playbook id is required.' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const playbook = await findOneWithDecryption(
      em,
      AgentGovernancePlaybook,
      { id: rawInput.id, deletedAt: null },
      undefined,
      scopeFromContext(ctx),
    )
    if (!playbook) throw new CrudHttpError(404, { error: 'Playbook not found.' })

    ensureRecordScope(ctx, playbook.tenantId, playbook.organizationId)

    playbook.deletedAt = new Date()
    playbook.updatedAt = new Date()
    await em.flush()
    const scheduleSync = await syncPlaybookSchedule(ctx, playbook)

    await recordCommandDecision(
      ctx,
      {
        tenantId: playbook.tenantId,
        organizationId: playbook.organizationId,
        runId: null,
        stepId: 'agent_governance.playbooks.delete',
        actionType: 'playbook.delete',
        targetEntity: 'agent_governance_playbook',
        targetId: playbook.id,
        sourceRefs: [],
        policyId: playbook.policyId ?? null,
        riskBandId: playbook.riskBandId ?? null,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: {
          operation: 'delete',
          deletedAt: playbook.deletedAt?.toISOString() ?? null,
          scheduleSync,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_soft',
        repairCode: 'PLAYBOOK_DELETE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.playbook.deleted', {
      id: playbook.id,
      tenantId: playbook.tenantId,
      organizationId: playbook.organizationId,
    })

    return { playbookId: playbook.id }
  },
}

registerCommand(createPlaybookCommand)
registerCommand(updatePlaybookCommand)
registerCommand(deletePlaybookCommand)
