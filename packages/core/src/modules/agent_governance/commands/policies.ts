import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentGovernancePolicy } from '../data/entities'
import {
  agentPolicyCreateSchema,
  agentPolicyUpdateSchema,
  type AgentPolicyCreateInput,
  type AgentPolicyUpdateInput,
} from '../data/validators'
import { emitAgentGovernanceEvent } from '../events'
import { ensureRecordScope, ensureTenantScope, recordCommandDecision, resolveHarnessProvider, scopeFromContext } from './shared'

type DeleteInput = { id: string }

const createPolicyCommand: CommandHandler<AgentPolicyCreateInput, { policyId: string }> = {
  id: 'agent_governance.policies.create',
  async execute(rawInput, ctx) {
    const input = agentPolicyCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureRecordScope(ctx, input.tenantId, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()
    const policy = em.create(AgentGovernancePolicy, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      defaultMode: input.defaultMode,
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(policy)
    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: policy.tenantId,
        organizationId: policy.organizationId,
        runId: null,
        stepId: 'agent_governance.policies.create',
        actionType: 'policy.create',
        targetEntity: 'agent_governance_policy',
        targetId: policy.id,
        sourceRefs: [],
        policyId: null,
        riskBandId: null,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: { operation: 'create' },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_soft',
        repairCode: 'POLICY_CREATE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.policy.created', {
      id: policy.id,
      tenantId: policy.tenantId,
      organizationId: policy.organizationId,
    })

    return { policyId: policy.id }
  },
}

const updatePolicyCommand: CommandHandler<AgentPolicyUpdateInput, { policyId: string }> = {
  id: 'agent_governance.policies.update',
  async execute(rawInput, ctx) {
    const input = agentPolicyUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const policy = await findOneWithDecryption(
      em,
      AgentGovernancePolicy,
      { id: input.id, deletedAt: null },
      undefined,
      scopeFromContext(ctx),
    )
    if (!policy) throw new CrudHttpError(404, { error: 'Policy not found.' })

    ensureRecordScope(ctx, policy.tenantId, policy.organizationId)

    if (input.name !== undefined) policy.name = input.name
    if (input.description !== undefined) policy.description = input.description ?? null
    if (input.defaultMode !== undefined) policy.defaultMode = input.defaultMode
    if (input.isActive !== undefined) policy.isActive = input.isActive
    policy.updatedAt = new Date()
    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: policy.tenantId,
        organizationId: policy.organizationId,
        runId: null,
        stepId: 'agent_governance.policies.update',
        actionType: 'policy.update',
        targetEntity: 'agent_governance_policy',
        targetId: policy.id,
        sourceRefs: [],
        policyId: policy.id,
        riskBandId: null,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: {
          operation: 'update',
          name: policy.name,
          defaultMode: policy.defaultMode,
          isActive: policy.isActive,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_soft',
        repairCode: 'POLICY_UPDATE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.policy.updated', {
      id: policy.id,
      tenantId: policy.tenantId,
      organizationId: policy.organizationId,
    })

    return { policyId: policy.id }
  },
}

const deletePolicyCommand: CommandHandler<DeleteInput, { policyId: string }> = {
  id: 'agent_governance.policies.delete',
  async execute(rawInput, ctx) {
    if (!rawInput || typeof rawInput.id !== 'string') {
      throw new CrudHttpError(400, { error: 'Policy id is required.' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const policy = await findOneWithDecryption(
      em,
      AgentGovernancePolicy,
      { id: rawInput.id, deletedAt: null },
      undefined,
      scopeFromContext(ctx),
    )
    if (!policy) throw new CrudHttpError(404, { error: 'Policy not found.' })

    ensureRecordScope(ctx, policy.tenantId, policy.organizationId)

    policy.deletedAt = new Date()
    policy.updatedAt = new Date()
    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: policy.tenantId,
        organizationId: policy.organizationId,
        runId: null,
        stepId: 'agent_governance.policies.delete',
        actionType: 'policy.delete',
        targetEntity: 'agent_governance_policy',
        targetId: policy.id,
        sourceRefs: [],
        policyId: policy.id,
        riskBandId: null,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: { operation: 'delete', deletedAt: policy.deletedAt?.toISOString() ?? null },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_soft',
        repairCode: 'POLICY_DELETE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.policy.deleted', {
      id: policy.id,
      tenantId: policy.tenantId,
      organizationId: policy.organizationId,
    })

    return { policyId: policy.id }
  },
}

registerCommand(createPolicyCommand)
registerCommand(updatePolicyCommand)
registerCommand(deletePolicyCommand)
