import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentGovernanceSkill, AgentGovernanceSkillVersion, type AgentSkillStatus } from '../data/entities'
import {
  agentSkillCaptureFromTraceSchema,
  agentSkillCreateSchema,
  agentSkillPromoteSchema,
  agentSkillUpdateSchema,
  agentSkillValidateSchema,
  type AgentSkillCaptureFromTraceInput,
  type AgentSkillCreateInput,
  type AgentSkillPromoteInput,
  type AgentSkillUpdateInput,
  type AgentSkillValidateInput,
} from '../data/validators'
import { emitAgentGovernanceEvent } from '../events'
import { ensureRecordScope, ensureTenantScope, recordCommandDecision, resolveHarnessProvider, scopeFromContext } from './shared'
import { PolicyViolationError, toCrudHttpError } from '../lib/domain-errors'
import type { SkillLifecycleService } from '../services/skill-lifecycle-service'

type DeleteInput = { id: string }

const allowedSkillStatusTransitions: Record<AgentSkillStatus, ReadonlySet<AgentSkillStatus>> = {
  draft: new Set(['draft', 'validated', 'deprecated']),
  validated: new Set(['validated', 'active', 'deprecated']),
  active: new Set(['active', 'deprecated']),
  deprecated: new Set(['deprecated']),
}

function assertStatusTransition(current: AgentSkillStatus, next: AgentSkillStatus): void {
  const allowed = allowedSkillStatusTransitions[current]
  if (!allowed || !allowed.has(next)) {
    throw toCrudHttpError(new PolicyViolationError(
      `Skill status transition ${current} -> ${next} is not allowed.`,
      'SKILL_STATUS_TRANSITION_BLOCKED',
    ))
  }
}

async function resolveNextVersionNo(em: EntityManager, skillId: string): Promise<number> {
  const latestVersion = await em.findOne(
    AgentGovernanceSkillVersion,
    { skill: skillId },
    { orderBy: { versionNo: 'DESC' } },
  )

  return (latestVersion?.versionNo ?? 0) + 1
}

const createSkillCommand: CommandHandler<AgentSkillCreateInput, { skillId: string }> = {
  id: 'agent_governance.skills.create',
  async execute(rawInput, ctx) {
    const input = agentSkillCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureRecordScope(ctx, input.tenantId, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const now = new Date()

    const initialStatus = input.status ?? 'draft'

    const skill = em.create(AgentGovernanceSkill, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      name: input.name,
      description: input.description ?? null,
      status: initialStatus,
      frameworkJson: input.frameworkJson ?? null,
      sourceType: input.sourceType ?? 'hybrid',
      createdAt: now,
      updatedAt: now,
    })
    em.persist(skill)
    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: skill.tenantId,
        organizationId: skill.organizationId,
        runId: null,
        stepId: 'agent_governance.skills.create',
        actionType: 'skill.create',
        targetEntity: 'agent_governance_skill',
        targetId: skill.id,
        sourceRefs: [],
        policyId: null,
        riskBandId: null,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: {
          operation: 'create',
          status: skill.status,
          sourceType: skill.sourceType,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_soft',
        repairCode: 'SKILL_CREATE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.skill.created', {
      id: skill.id,
      status: skill.status,
      tenantId: skill.tenantId,
      organizationId: skill.organizationId,
    })

    return { skillId: skill.id }
  },
}

const updateSkillCommand: CommandHandler<AgentSkillUpdateInput, { skillId: string }> = {
  id: 'agent_governance.skills.update',
  async execute(rawInput, ctx) {
    const input = agentSkillUpdateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const skill = await findOneWithDecryption(
      em,
      AgentGovernanceSkill,
      { id: input.id, deletedAt: null },
      undefined,
      scopeFromContext(ctx),
    )
    if (!skill) throw new CrudHttpError(404, { error: 'Skill not found.' })

    ensureRecordScope(ctx, skill.tenantId, skill.organizationId)

    if (input.name !== undefined) skill.name = input.name
    if (input.description !== undefined) skill.description = input.description ?? null
    if (input.status !== undefined) {
      assertStatusTransition(skill.status, input.status)
      skill.status = input.status
    }
    if (input.frameworkJson !== undefined) skill.frameworkJson = input.frameworkJson ?? null
    if (input.sourceType !== undefined) skill.sourceType = input.sourceType
    skill.updatedAt = new Date()
    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: skill.tenantId,
        organizationId: skill.organizationId,
        runId: null,
        stepId: 'agent_governance.skills.update',
        actionType: 'skill.update',
        targetEntity: 'agent_governance_skill',
        targetId: skill.id,
        sourceRefs: [],
        policyId: null,
        riskBandId: null,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: {
          operation: 'update',
          status: skill.status,
          sourceType: skill.sourceType,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_soft',
        repairCode: 'SKILL_UPDATE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.skill.updated', {
      id: skill.id,
      status: skill.status,
      tenantId: skill.tenantId,
      organizationId: skill.organizationId,
    })

    return { skillId: skill.id }
  },
}

const deleteSkillCommand: CommandHandler<DeleteInput, { skillId: string }> = {
  id: 'agent_governance.skills.delete',
  async execute(rawInput, ctx) {
    if (!rawInput || typeof rawInput.id !== 'string') {
      throw new CrudHttpError(400, { error: 'Skill id is required.' })
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const skill = await findOneWithDecryption(
      em,
      AgentGovernanceSkill,
      { id: rawInput.id, deletedAt: null },
      undefined,
      scopeFromContext(ctx),
    )
    if (!skill) throw new CrudHttpError(404, { error: 'Skill not found.' })

    ensureRecordScope(ctx, skill.tenantId, skill.organizationId)

    skill.status = 'deprecated'
    skill.deletedAt = new Date()
    skill.updatedAt = new Date()
    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: skill.tenantId,
        organizationId: skill.organizationId,
        runId: null,
        stepId: 'agent_governance.skills.delete',
        actionType: 'skill.delete',
        targetEntity: 'agent_governance_skill',
        targetId: skill.id,
        sourceRefs: [],
        policyId: null,
        riskBandId: null,
        riskScore: null,
        controlPath: 'override',
        approverIds: [],
        exceptionIds: [],
        writeSet: {
          operation: 'delete',
          status: skill.status,
          deletedAt: skill.deletedAt?.toISOString() ?? null,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_soft',
        repairCode: 'SKILL_DELETE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.skill.deleted', {
      id: skill.id,
      status: skill.status,
      tenantId: skill.tenantId,
      organizationId: skill.organizationId,
    })

    return { skillId: skill.id }
  },
}

const captureSkillFromTraceCommand: CommandHandler<
  AgentSkillCaptureFromTraceInput,
  {
    skillId: string
    status: AgentSkillStatus
    validationReport: Record<string, unknown> | null
    skillVersionId: string | null
    versionNo: number | null
  }
> = {
  id: 'agent_governance.skills.capture_from_trace',
  async execute(rawInput, ctx) {
    const input = agentSkillCaptureFromTraceSchema.parse(rawInput)
    ensureTenantScope(ctx, input.tenantId)
    ensureRecordScope(ctx, input.tenantId, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const skillLifecycleService = ctx.container.resolve('agentGovernanceSkillLifecycleService') as SkillLifecycleService

    const candidate = await skillLifecycleService.captureCandidateFromTraces({
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      decisionEventIds: input.decisionEventIds,
      actionType: input.actionType ?? null,
      targetEntity: input.targetEntity ?? null,
      targetId: input.targetId ?? null,
      suggestedName: input.name ?? null,
      suggestedDescription: input.description ?? null,
      postmortem: input.postmortem ?? null,
      sampleSize: input.sampleSize,
    })

    const now = new Date()

    const skill = em.create(AgentGovernanceSkill, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      name: input.name ?? candidate.name,
      description: input.description ?? candidate.description,
      status: 'draft',
      frameworkJson: candidate.frameworkJson,
      sourceType: candidate.sourceType,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(skill)

    let validationReport: Record<string, unknown> | null = null
    let skillVersionId: string | null = null
    let versionNo: number | null = null

    if (input.autoValidate) {
      const report = await skillLifecycleService.validateSkillDefinition({
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        skill,
        sampleSize: input.sampleSize,
        passRateThreshold: input.passRateThreshold,
      })

      validationReport = report as unknown as Record<string, unknown>

      const nextVersionNo = await resolveNextVersionNo(em, skill.id)
      const skillVersion = em.create(AgentGovernanceSkillVersion, {
        tenantId: skill.tenantId,
        organizationId: skill.organizationId,
        skill,
        versionNo: nextVersionNo,
        diffJson: {
          type: 'trace_capture_validation',
          approvalDecision: input.approvalDecision,
        },
        validationReportJson: report,
        promotedByUserId: ctx.auth?.sub ?? null,
        promotionIdempotencyKey: input.idempotencyKey ?? null,
        createdAt: now,
        updatedAt: now,
      })

      em.persist(skillVersion)
      skillVersionId = skillVersion.id
      versionNo = skillVersion.versionNo

      if (input.approvalDecision === 'approve' && report.passed) {
        skill.status = 'validated'
      }
    }

    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: skill.tenantId,
        organizationId: skill.organizationId,
        runId: null,
        stepId: 'agent_governance.skills.capture_from_trace',
        actionType: 'skill.capture',
        targetEntity: 'agent_governance_skill',
        targetId: skill.id,
        sourceRefs: candidate.evidenceEventIds.map((eventId) => `decision_event:${eventId}`),
        policyId: null,
        riskBandId: null,
        riskScore: null,
        controlPath: 'override',
        approverIds: ctx.auth?.sub ? [ctx.auth.sub] : [],
        exceptionIds: [],
        writeSet: {
          operation: 'capture',
          status: skill.status,
          sourceType: skill.sourceType,
          evidenceEventCount: candidate.evidenceEventIds.length,
          autoValidate: input.autoValidate,
          validationPassed: validationReport ? Boolean((validationReport.passed as boolean | undefined) ?? false) : null,
          skillVersionId,
          versionNo,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_soft',
        repairCode: 'SKILL_CAPTURE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.skill.created', {
      id: skill.id,
      status: skill.status,
      tenantId: skill.tenantId,
      organizationId: skill.organizationId,
    })

    await emitAgentGovernanceEvent('agent_governance.skill.captured', {
      id: skill.id,
      status: skill.status,
      sourceType: skill.sourceType,
      tenantId: skill.tenantId,
      organizationId: skill.organizationId,
      evidenceEventCount: candidate.evidenceEventIds.length,
    })

    if (skill.status === 'validated') {
      await emitAgentGovernanceEvent('agent_governance.skill.validated', {
        id: skill.id,
        status: skill.status,
        tenantId: skill.tenantId,
        organizationId: skill.organizationId,
        validationReport,
      })
    }

    return {
      skillId: skill.id,
      status: skill.status,
      validationReport,
      skillVersionId,
      versionNo,
    }
  },
}

const validateSkillCommand: CommandHandler<
  AgentSkillValidateInput,
  {
    skillId: string
    status: AgentSkillStatus
    passed: boolean
    passRate: number
    skillVersionId: string
    versionNo: number
    validationReport: Record<string, unknown>
  }
> = {
  id: 'agent_governance.skills.validate',
  async execute(rawInput, ctx) {
    const input = agentSkillValidateSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const skill = await findOneWithDecryption(
      em,
      AgentGovernanceSkill,
      { id: input.id, deletedAt: null },
      undefined,
      scopeFromContext(ctx),
    )
    if (!skill) throw new CrudHttpError(404, { error: 'Skill not found.' })

    ensureRecordScope(ctx, skill.tenantId, skill.organizationId)

    if (skill.status === 'deprecated') {
      throw toCrudHttpError(new PolicyViolationError('Deprecated skills cannot be validated.', 'SKILL_VALIDATE_BLOCKED'))
    }

    if (input.idempotencyKey) {
      const existingVersion = await findOneWithDecryption(
        em,
        AgentGovernanceSkillVersion,
        {
          tenantId: skill.tenantId,
          organizationId: skill.organizationId,
          promotionIdempotencyKey: input.idempotencyKey,
        },
        { populate: ['skill'] },
        scopeFromContext(ctx),
      )

      if (existingVersion) {
        if (existingVersion.skill.id !== skill.id) {
          throw new CrudHttpError(409, { error: 'Idempotency key already used for a different skill.' })
        }

        const validationReport = (existingVersion.validationReportJson ?? {}) as Record<string, unknown>

        return {
          skillId: skill.id,
          status: skill.status,
          passed: Boolean(validationReport.passed),
          passRate: typeof validationReport.passRate === 'number' ? validationReport.passRate : 0,
          skillVersionId: existingVersion.id,
          versionNo: existingVersion.versionNo,
          validationReport,
        }
      }
    }

    const skillLifecycleService = ctx.container.resolve('agentGovernanceSkillLifecycleService') as SkillLifecycleService

    const report = await skillLifecycleService.validateSkillDefinition({
      tenantId: skill.tenantId,
      organizationId: skill.organizationId,
      skill,
      sampleSize: input.sampleSize,
      passRateThreshold: input.passRateThreshold,
    })

    if (input.approvalDecision === 'approve' && !report.passed) {
      throw toCrudHttpError(new PolicyViolationError(
        'Skill validation did not pass threshold. Approval denied.',
        'SKILL_VALIDATION_THRESHOLD_NOT_MET',
      ))
    }

    const now = new Date()
    const nextVersionNo = await resolveNextVersionNo(em, skill.id)

    const skillVersion = em.create(AgentGovernanceSkillVersion, {
      tenantId: skill.tenantId,
      organizationId: skill.organizationId,
      skill,
      versionNo: nextVersionNo,
      diffJson: {
        type: 'validation',
        approvalDecision: input.approvalDecision,
        comment: input.comment ?? null,
      },
      validationReportJson: report,
      promotedByUserId: ctx.auth?.sub ?? null,
      promotionIdempotencyKey: input.idempotencyKey ?? null,
      createdAt: now,
      updatedAt: now,
    })

    em.persist(skillVersion)

    if (input.approvalDecision === 'approve') {
      assertStatusTransition(skill.status, 'validated')
      skill.status = 'validated'
      skill.updatedAt = now
    }

    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: skill.tenantId,
        organizationId: skill.organizationId,
        runId: null,
        stepId: 'agent_governance.skills.validate',
        actionType: 'skill.validate',
        targetEntity: 'agent_governance_skill',
        targetId: skill.id,
        sourceRefs: report.sampledEventIds.map((eventId) => `decision_event:${eventId}`),
        policyId: null,
        riskBandId: null,
        riskScore: null,
        controlPath: input.approvalDecision === 'approve' ? 'override' : 'rejected',
        approverIds: ctx.auth?.sub ? [ctx.auth.sub] : [],
        exceptionIds: [],
        writeSet: {
          operation: 'validate',
          status: skill.status,
          approvalDecision: input.approvalDecision,
          passRate: report.passRate,
          threshold: report.threshold,
          sampledEvents: report.sampledEvents,
          matchedEvents: report.matchedEvents,
          skillVersionId: skillVersion.id,
          versionNo: skillVersion.versionNo,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_closed',
        repairCode: 'SKILL_VALIDATE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    if (input.approvalDecision === 'approve') {
      await emitAgentGovernanceEvent('agent_governance.skill.validated', {
        id: skill.id,
        status: skill.status,
        tenantId: skill.tenantId,
        organizationId: skill.organizationId,
        validationReport: report,
        skillVersionId: skillVersion.id,
        versionNo: skillVersion.versionNo,
      })
    } else {
      await emitAgentGovernanceEvent('agent_governance.skill.validation_rejected', {
        id: skill.id,
        status: skill.status,
        tenantId: skill.tenantId,
        organizationId: skill.organizationId,
        validationReport: report,
        skillVersionId: skillVersion.id,
        versionNo: skillVersion.versionNo,
      })
    }

    return {
      skillId: skill.id,
      status: skill.status,
      passed: report.passed,
      passRate: report.passRate,
      skillVersionId: skillVersion.id,
      versionNo: skillVersion.versionNo,
      validationReport: report as unknown as Record<string, unknown>,
    }
  },
}

const promoteSkillCommand: CommandHandler<
  AgentSkillPromoteInput,
  { skillId: string; skillVersionId: string; versionNo: number }
> = {
  id: 'agent_governance.skills.promote',
  async execute(rawInput, ctx) {
    const input = agentSkillPromoteSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const skill = await findOneWithDecryption(
      em,
      AgentGovernanceSkill,
      { id: input.id, deletedAt: null },
      undefined,
      scopeFromContext(ctx),
    )
    if (!skill) throw new CrudHttpError(404, { error: 'Skill not found.' })

    ensureRecordScope(ctx, skill.tenantId, skill.organizationId)

    if (skill.status === 'deprecated') {
      throw toCrudHttpError(new PolicyViolationError('Deprecated skills cannot be promoted.', 'SKILL_PROMOTE_BLOCKED'))
    }

    if (skill.status !== 'validated' && skill.status !== 'active') {
      throw toCrudHttpError(
        new PolicyViolationError('Skill must be validated before promotion.', 'SKILL_PROMOTE_REQUIRES_VALIDATION'),
      )
    }

    if (input.idempotencyKey) {
      const existingVersion = await findOneWithDecryption(
        em,
        AgentGovernanceSkillVersion,
        {
          tenantId: skill.tenantId,
          organizationId: skill.organizationId,
          promotionIdempotencyKey: input.idempotencyKey,
        },
        { populate: ['skill'] },
        scopeFromContext(ctx),
      )
      if (existingVersion) {
        if (existingVersion.skill.id !== skill.id) {
          throw new CrudHttpError(409, { error: 'Idempotency key already used for a different skill.' })
        }
        return {
          skillId: skill.id,
          skillVersionId: existingVersion.id,
          versionNo: existingVersion.versionNo,
        }
      }
    }

    const nextVersionNo = await resolveNextVersionNo(em, skill.id)
    const now = new Date()

    const skillVersion = em.create(AgentGovernanceSkillVersion, {
      tenantId: skill.tenantId,
      organizationId: skill.organizationId,
      skill,
      versionNo: nextVersionNo,
      diffJson: input.diffJson ?? null,
      validationReportJson: input.validationReportJson ?? null,
      promotedByUserId: ctx.auth?.sub ?? null,
      promotionIdempotencyKey: input.idempotencyKey ?? null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(skillVersion)

    skill.status = 'active'
    skill.updatedAt = now
    await em.flush()

    await recordCommandDecision(
      ctx,
      {
        tenantId: skill.tenantId,
        organizationId: skill.organizationId,
        runId: null,
        stepId: 'agent_governance.skills.promote',
        actionType: 'skill.promote',
        targetEntity: 'agent_governance_skill',
        targetId: skill.id,
        sourceRefs: [],
        policyId: null,
        riskBandId: null,
        riskScore: null,
        controlPath: 'override',
        approverIds: ctx.auth?.sub ? [ctx.auth.sub] : [],
        exceptionIds: [],
        writeSet: {
          operation: 'promote',
          skillVersionId: skillVersion.id,
          versionNo: skillVersion.versionNo,
          status: skill.status,
        },
        status: 'success',
        errorCode: null,
        harnessProvider: resolveHarnessProvider(ctx),
      },
      {
        durability: 'fail_closed',
        repairCode: 'SKILL_PROMOTE_TELEMETRY_REPAIR_REQUIRED',
      },
    )

    await emitAgentGovernanceEvent('agent_governance.skill.promoted', {
      id: skill.id,
      status: skill.status,
      tenantId: skill.tenantId,
      organizationId: skill.organizationId,
      skillVersionId: skillVersion.id,
      versionNo: skillVersion.versionNo,
    })

    return { skillId: skill.id, skillVersionId: skillVersion.id, versionNo: skillVersion.versionNo }
  },
}

registerCommand(createSkillCommand)
registerCommand(updateSkillCommand)
registerCommand(deleteSkillCommand)
registerCommand(captureSkillFromTraceCommand)
registerCommand(validateSkillCommand)
registerCommand(promoteSkillCommand)
