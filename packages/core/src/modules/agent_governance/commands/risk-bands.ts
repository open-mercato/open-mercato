import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentGovernanceRiskBand } from '../data/entities'
import {
  agentRiskBandCreateSchema,
  agentRiskBandUpdateSchema,
  type AgentRiskBandCreateInput,
  type AgentRiskBandUpdateInput,
} from '../data/validators'
import { emitAgentGovernanceEvent } from '../events'
import { ensureRecordScope, ensureTenantScope, recordCommandDecision, resolveHarnessProvider, scopeFromContext } from './shared'

type DeleteInput = { id: string }

const createRiskBandCommand: CommandHandler<AgentRiskBandCreateInput, { riskBandId: string }> = {
  id: 'agent_governance.risk_bands.create',
  async execute(rawInput, ctx) {
    const input = agentRiskBandCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureRecordScope(ctx, input.tenantId, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()

    if (input.minScore !== undefined && input.maxScore !== undefined && input.minScore > input.maxScore) {
      throw new CrudHttpError(400, { error: 'minScore cannot be greater than maxScore.' })
    }

    const riskBand = em.create(AgentGovernanceRiskBand, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      name: input.name,
      riskLevel: input.riskLevel,
      description: input.description ?? null,
      requiresApproval: input.requiresApproval ?? false,
      failClosed: input.failClosed ?? false,
      isDefault: input.isDefault ?? false,
      minScore: input.minScore ?? 0,
      maxScore: input.maxScore ?? 100,
      createdAt: now,
      updatedAt: now,
    })

    if (riskBand.isDefault) {
      await em.nativeUpdate(
        AgentGovernanceRiskBand,
        {
          tenantId: riskBand.tenantId,
          organizationId: riskBand.organizationId,
          deletedAt: null,
          isDefault: true,
        },
        { isDefault: false },
      )
    }

    em.persist(riskBand)
    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: riskBand.tenantId,
        organizationId: riskBand.organizationId,
        runId: null,
        stepId: 'agent_governance.risk_bands.create',
        actionType: 'risk_band.create',
        targetEntity: 'agent_governance_risk_band',
        targetId: riskBand.id,
        sourceRefs: [],
        policyId: null,
        riskBandId: riskBand.id,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: {
          operation: 'create',
          riskLevel: riskBand.riskLevel,
          failClosed: riskBand.failClosed,
          requiresApproval: riskBand.requiresApproval,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: riskBand.failClosed ? 'fail_closed' : 'fail_soft',
        repairCode: 'RISK_BAND_CREATE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.risk_band.created', {
      id: riskBand.id,
      tenantId: riskBand.tenantId,
      organizationId: riskBand.organizationId,
    })

    return { riskBandId: riskBand.id }
  },
}

const updateRiskBandCommand: CommandHandler<AgentRiskBandUpdateInput, { riskBandId: string }> = {
  id: 'agent_governance.risk_bands.update',
  async execute(rawInput, ctx) {
    const input = agentRiskBandUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const riskBand = await findOneWithDecryption(
      em,
      AgentGovernanceRiskBand,
      { id: input.id, deletedAt: null },
      undefined,
      scopeFromContext(ctx),
    )

    if (!riskBand) throw new CrudHttpError(404, { error: 'Risk band not found.' })

    ensureRecordScope(ctx, riskBand.tenantId, riskBand.organizationId)

    const nextMinScore = input.minScore ?? riskBand.minScore
    const nextMaxScore = input.maxScore ?? riskBand.maxScore
    if (nextMinScore > nextMaxScore) {
      throw new CrudHttpError(400, { error: 'minScore cannot be greater than maxScore.' })
    }

    if (input.name !== undefined) riskBand.name = input.name
    if (input.riskLevel !== undefined) riskBand.riskLevel = input.riskLevel
    if (input.description !== undefined) riskBand.description = input.description ?? null
    if (input.requiresApproval !== undefined) riskBand.requiresApproval = input.requiresApproval
    if (input.failClosed !== undefined) riskBand.failClosed = input.failClosed
    if (input.minScore !== undefined) riskBand.minScore = input.minScore
    if (input.maxScore !== undefined) riskBand.maxScore = input.maxScore
    if (input.isDefault !== undefined) {
      if (input.isDefault) {
        await em.nativeUpdate(
          AgentGovernanceRiskBand,
          {
            tenantId: riskBand.tenantId,
            organizationId: riskBand.organizationId,
            deletedAt: null,
            isDefault: true,
          },
          { isDefault: false },
        )
      }
      riskBand.isDefault = input.isDefault
    }

    riskBand.updatedAt = new Date()
    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: riskBand.tenantId,
        organizationId: riskBand.organizationId,
        runId: null,
        stepId: 'agent_governance.risk_bands.update',
        actionType: 'risk_band.update',
        targetEntity: 'agent_governance_risk_band',
        targetId: riskBand.id,
        sourceRefs: [],
        policyId: null,
        riskBandId: riskBand.id,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: {
          operation: 'update',
          riskLevel: riskBand.riskLevel,
          minScore: riskBand.minScore,
          maxScore: riskBand.maxScore,
          failClosed: riskBand.failClosed,
          requiresApproval: riskBand.requiresApproval,
          isDefault: riskBand.isDefault,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: riskBand.failClosed ? 'fail_closed' : 'fail_soft',
        repairCode: 'RISK_BAND_UPDATE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.risk_band.updated', {
      id: riskBand.id,
      tenantId: riskBand.tenantId,
      organizationId: riskBand.organizationId,
    })

    return { riskBandId: riskBand.id }
  },
}

const deleteRiskBandCommand: CommandHandler<DeleteInput, { riskBandId: string }> = {
  id: 'agent_governance.risk_bands.delete',
  async execute(rawInput, ctx) {
    if (!rawInput || typeof rawInput.id !== 'string') {
      throw new CrudHttpError(400, { error: 'Risk band id is required.' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const riskBand = await findOneWithDecryption(
      em,
      AgentGovernanceRiskBand,
      { id: rawInput.id, deletedAt: null },
      undefined,
      scopeFromContext(ctx),
    )

    if (!riskBand) throw new CrudHttpError(404, { error: 'Risk band not found.' })

    ensureRecordScope(ctx, riskBand.tenantId, riskBand.organizationId)

    riskBand.deletedAt = new Date()
    riskBand.updatedAt = new Date()
    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: riskBand.tenantId,
        organizationId: riskBand.organizationId,
        runId: null,
        stepId: 'agent_governance.risk_bands.delete',
        actionType: 'risk_band.delete',
        targetEntity: 'agent_governance_risk_band',
        targetId: riskBand.id,
        sourceRefs: [],
        policyId: null,
        riskBandId: riskBand.id,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: { operation: 'delete', deletedAt: riskBand.deletedAt?.toISOString() ?? null },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: riskBand.failClosed ? 'fail_closed' : 'fail_soft',
        repairCode: 'RISK_BAND_DELETE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.risk_band.deleted', {
      id: riskBand.id,
      tenantId: riskBand.tenantId,
      organizationId: riskBand.organizationId,
    })

    return { riskBandId: riskBand.id }
  },
}

registerCommand(createRiskBandCommand)
registerCommand(updateRiskBandCommand)
registerCommand(deleteRiskBandCommand)
