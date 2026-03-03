import { z } from 'zod'
import type { CommandRuntimeContext, CommandBus } from '@open-mercato/shared/lib/commands'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  AgentGovernanceDecisionEntityLink,
  AgentGovernanceDecisionEvent,
  AgentGovernanceDecisionWhyLink,
  AgentGovernancePrecedentIndex,
  AgentGovernanceRiskBand,
} from './data/entities'
import { resolveActionClass } from './services/run-orchestrator-service'
import type { RetrievalPlannerService } from './services/retrieval-planner-service'
import type { ToolGrantActionClass, ToolGrantService } from './services/tool-grant-service'

type ToolContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: {
    resolve: <T = unknown>(name: string) => T
  }
  userFeatures: string[]
  isSuperAdmin: boolean
}

type AiToolDefinition<TInput = unknown, TOutput = unknown> = {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures?: string[]
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>
}

function toCommandCtx(ctx: ToolContext): CommandRuntimeContext {
  return {
    container: ctx.container as unknown as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: ctx.organizationId,
    organizationIds: ctx.organizationId ? [ctx.organizationId] : null,
  }
}

function requireScope(ctx: ToolContext): { tenantId: string; organizationId: string } {
  if (!ctx.tenantId || !ctx.organizationId) {
    throw new Error('Tenant and organization context are required.')
  }

  return {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  }
}

type ToolGrantResolver<TInput> = (input: TInput) => {
  actionClass: ToolGrantActionClass
  policyId?: string | null
  riskScore?: number | null
}

function withPolicyAwareGrant<TInput, TOutput>(
  toolName: string,
  resolveGrantInput: ToolGrantResolver<TInput>,
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>,
): (input: TInput, ctx: ToolContext) => Promise<TOutput> {
  return async (input, ctx) => {
    const { tenantId, organizationId } = requireScope(ctx)
    const toolGrantService = ctx.container.resolve<ToolGrantService>('agentGovernanceToolGrantService')
    const grantInput = resolveGrantInput(input)

    await toolGrantService.assertToolGrant({
      toolName,
      tenantId,
      organizationId,
      actionClass: grantInput.actionClass,
      policyId: grantInput.policyId ?? null,
      riskScore: grantInput.riskScore ?? null,
    })

    return handler(input, ctx)
  }
}

function aliasTool<TInput, TOutput>(
  tool: AiToolDefinition<TInput, TOutput>,
  name: string,
  description?: string,
): AiToolDefinition<TInput, TOutput> {
  return {
    ...tool,
    name,
    description: description ?? tool.description,
  }
}

const runToolInputSchema = z.object({
  actionType: z.string().min(1),
  targetEntity: z.string().min(1),
  targetId: z.string().optional(),
  playbookId: z.string().uuid().optional(),
  policyId: z.string().uuid().optional(),
  riskBandId: z.string().uuid().optional(),
  autonomyMode: z.enum(['propose', 'assist', 'auto']).optional().default('propose'),
  actionClass: z.enum(['read', 'write', 'irreversible']).optional(),
  riskScore: z.number().int().min(0).max(100).optional(),
  requireApproval: z.boolean().optional(),
  inputContext: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
})

type RunToolInput = z.infer<typeof runToolInputSchema>

const runTool: AiToolDefinition<RunToolInput, { runId: string | null; approvalTaskId: string | null }> = {
  name: 'agent_run',
  description: 'Start a governed run with risk-aware controls.',
  inputSchema: runToolInputSchema,
  requiredFeatures: ['agent_governance.tools.use', 'agent_governance.runs.manage'],
  handler: withPolicyAwareGrant(
    'agent_run',
    (input) => ({
      actionClass: resolveActionClass(input.actionType, input.actionClass),
      policyId: input.policyId ?? null,
      riskScore: input.riskScore ?? null,
    }),
    async (input, ctx) => {
      const { tenantId, organizationId } = requireScope(ctx)

      const commandBus = ctx.container.resolve<CommandBus>('commandBus')
      const commandCtx = toCommandCtx(ctx)
      const retrievalPlannerService = ctx.container.resolve<RetrievalPlannerService>('agentGovernanceRetrievalPlannerService')
      const retrievalBudgetCandidate =
        input.inputContext && typeof input.inputContext === 'object'
          ? (input.inputContext.retrievalBudget as Record<string, unknown> | undefined)
          : undefined

      const retrievalPlan = await retrievalPlannerService.planContextBundle({
        tenantId,
        organizationId,
        actionType: input.actionType,
        targetEntity: input.targetEntity,
        targetId: input.targetId ?? null,
        signature: null,
        query: `${input.actionType} ${input.targetEntity}${input.targetId ? ` ${input.targetId}` : ''}`,
        budget: {
          tokenBudget:
            typeof retrievalBudgetCandidate?.tokenBudget === 'number'
              ? retrievalBudgetCandidate.tokenBudget
              : undefined,
          costBudgetUsd:
            typeof retrievalBudgetCandidate?.costBudgetUsd === 'number'
              ? retrievalBudgetCandidate.costBudgetUsd
              : undefined,
          timeBudgetMs:
            typeof retrievalBudgetCandidate?.timeBudgetMs === 'number'
              ? retrievalBudgetCandidate.timeBudgetMs
              : undefined,
        },
      })

      const { result } = await commandBus.execute('agent_governance.runs.start', {
        input: {
          ...input,
          tenantId,
          organizationId,
          sourceRefs: retrievalPlan.sourceRefs,
          inputContext: {
            ...(input.inputContext ?? {}),
            retrievalBundleId: retrievalPlan.bundleId,
            retrievalFallbackUsed: retrievalPlan.fallbackUsed,
            retrievalSliceCount: retrievalPlan.slices.length,
            retrievalEstimatedTokens: retrievalPlan.estimatedTokens,
            retrievalEstimatedCostUsd: retrievalPlan.estimatedCostUsd,
            retrievalProvider: retrievalPlan.retrievalProvider,
            retrievalProviderFallbackUsed: retrievalPlan.providerFallbackUsed,
            retrievalSlices: retrievalPlan.slices.map((slice) => ({
              kind: slice.kind,
              sourceRef: slice.sourceRef,
              score: slice.score,
            })),
          },
        },
        ctx: commandCtx,
      })

      return {
        runId: (result as { runId?: string }).runId ?? null,
        approvalTaskId: (result as { approvalTaskId?: string | null }).approvalTaskId ?? null,
      }
    },
  ),
}

const riskCheckToolInputSchema = z.object({
  score: z.number().int().min(0).max(100),
})

type RiskCheckToolInput = z.infer<typeof riskCheckToolInputSchema>

const riskCheckTool: AiToolDefinition<RiskCheckToolInput, { score: number; riskBand: AgentGovernanceRiskBand | null }> = {
  name: 'risk_check',
  description: 'Resolve matching risk band for a given score.',
  inputSchema: riskCheckToolInputSchema,
  requiredFeatures: ['agent_governance.tools.use', 'agent_governance.risk_bands.manage'],
  handler: withPolicyAwareGrant(
    'risk_check',
    () => ({ actionClass: 'read' }),
    async (input, ctx) => {
      const { tenantId, organizationId } = requireScope(ctx)

      const em = ctx.container.resolve<EntityManager>('em')

      const rows = await findWithDecryption(
        em,
        AgentGovernanceRiskBand,
        {
          tenantId,
          organizationId,
          deletedAt: null,
          minScore: { $lte: input.score },
          maxScore: { $gte: input.score },
        },
        {
          orderBy: [{ isDefault: 'DESC' }, { maxScore: 'ASC' }],
          limit: 1,
        },
        { tenantId, organizationId },
      )

      const match = rows[0] ?? null

      return {
        score: input.score,
        riskBand: match,
      }
    },
  ),
}

const precedentSearchToolInputSchema = z.object({
  query: z.string().min(1),
  signature: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

type PrecedentSearchToolInput = z.infer<typeof precedentSearchToolInputSchema>

const precedentSearchTool: AiToolDefinition<PrecedentSearchToolInput, { items: AgentGovernancePrecedentIndex[] }> = {
  name: 'precedent_search',
  description: 'Search precedent memory by summary text or signature.',
  inputSchema: precedentSearchToolInputSchema,
  requiredFeatures: ['agent_governance.tools.use', 'agent_governance.memory.view'],
  handler: withPolicyAwareGrant(
    'precedent_search',
    () => ({ actionClass: 'read' }),
    async (input, ctx) => {
      const { tenantId, organizationId } = requireScope(ctx)

      const em = ctx.container.resolve<EntityManager>('em')

      const where: {
        tenantId: string
        organizationId: string
        signature?: string
        summary?: { $ilike: string }
      } = {
        tenantId,
        organizationId,
      }

      if (input.signature) {
        where.signature = input.signature
      } else {
        where.summary = { $ilike: `%${escapeLikePattern(input.query)}%` }
      }

      const rows = await findWithDecryption(
        em,
        AgentGovernancePrecedentIndex,
        where,
        {
          limit: input.limit,
          orderBy: [{ score: 'DESC' }, { createdAt: 'DESC' }],
        },
        { tenantId, organizationId },
      )

      return {
        items: rows,
      }
    },
  ),
}

const precedentExplainToolInputSchema = z.object({
  eventId: z.string().uuid(),
})

type PrecedentExplainToolInput = z.infer<typeof precedentExplainToolInputSchema>

const precedentExplainTool: AiToolDefinition<
  PrecedentExplainToolInput,
  { found: false; error: string } | { found: true; event: AgentGovernanceDecisionEvent; whyLinks: AgentGovernanceDecisionWhyLink[] }
> = {
  name: 'precedent_explain',
  description: 'Explain why a specific decision event happened.',
  inputSchema: precedentExplainToolInputSchema,
  requiredFeatures: ['agent_governance.tools.use', 'agent_governance.memory.view'],
  handler: withPolicyAwareGrant(
    'precedent_explain',
    () => ({ actionClass: 'read' }),
    async (input, ctx) => {
      const { tenantId, organizationId } = requireScope(ctx)

      const em = ctx.container.resolve<EntityManager>('em')

      const event = await findOneWithDecryption(
        em,
        AgentGovernanceDecisionEvent,
        {
          id: input.eventId,
          tenantId,
          organizationId,
        },
        undefined,
        { tenantId, organizationId },
      )

      if (!event) {
        return { found: false, error: 'Decision event not found.' }
      }

      const whyLinks = await findWithDecryption(
        em,
        AgentGovernanceDecisionWhyLink,
        {
          decisionEvent: event.id,
          tenantId,
          organizationId,
        },
        { orderBy: { createdAt: 'ASC' } },
        { tenantId, organizationId },
      )

      return {
        found: true,
        event,
        whyLinks,
      }
    },
  ),
}

const contextExpandToolInputSchema = z.object({
  eventId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).optional().default(20),
})

type ContextExpandToolInput = z.infer<typeof contextExpandToolInputSchema>

const contextExpandTool: AiToolDefinition<
  ContextExpandToolInput,
  { neighbors: Array<{ eventId: string; entityType: string; entityId: string; relationshipType: string; createdAt: Date }> }
> = {
  name: 'context_expand',
  description: 'Expand context graph neighbors for a decision event.',
  inputSchema: contextExpandToolInputSchema,
  requiredFeatures: ['agent_governance.tools.use', 'agent_governance.memory.view'],
  handler: withPolicyAwareGrant(
    'context_expand',
    () => ({ actionClass: 'read' }),
    async (input, ctx) => {
      const { tenantId, organizationId } = requireScope(ctx)

      const em = ctx.container.resolve<EntityManager>('em')

      const anchorLinks = await findWithDecryption(
        em,
        AgentGovernanceDecisionEntityLink,
        {
          decisionEvent: input.eventId,
          tenantId,
          organizationId,
        },
        {
          limit: input.limit,
          orderBy: { createdAt: 'DESC' },
        },
        { tenantId, organizationId },
      )

      if (anchorLinks.length === 0) {
        return { neighbors: [] }
      }

      const entityPairs = anchorLinks.map((link) => `${link.entityType}:${link.entityId}`)
      const entityTypes = [...new Set(anchorLinks.map((link) => link.entityType))]
      const entityIds = [...new Set(anchorLinks.map((link) => link.entityId))]

      const rows = await findWithDecryption(
        em,
        AgentGovernanceDecisionEntityLink,
        {
          tenantId,
          organizationId,
          entityType: { $in: entityTypes },
          entityId: { $in: entityIds },
          decisionEvent: { $ne: input.eventId },
        },
        {
          limit: input.limit,
          orderBy: { createdAt: 'DESC' },
        },
        { tenantId, organizationId },
      )

      return {
        neighbors: rows
          .filter((row) => entityPairs.includes(`${row.entityType}:${row.entityId}`))
          .map((row) => ({
            eventId: row.decisionEvent.id,
            entityType: row.entityType,
            entityId: row.entityId,
            relationshipType: row.relationshipType,
            createdAt: row.createdAt,
          })),
      }
    },
  ),
}

const skillCaptureToolInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).optional(),
  frameworkJson: z.record(z.string(), z.unknown()).optional(),
  sourceType: z.enum(['interview', 'trace_mining', 'hybrid']).optional(),
  status: z.enum(['draft', 'validated', 'active', 'deprecated']).optional(),
  decisionEventIds: z.array(z.string().uuid()).max(250).optional(),
  actionType: z.string().min(1).max(200).optional(),
  targetEntity: z.string().min(1).max(200).optional(),
  targetId: z.string().max(255).optional(),
  postmortem: z.string().max(10000).optional(),
  autoValidate: z.boolean().optional().default(false),
  passRateThreshold: z.number().min(0).max(1).optional(),
  approvalDecision: z.enum(['approve', 'reject']).optional().default('approve'),
  promote: z.boolean().optional().default(false),
  validationReportJson: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
})

type SkillCaptureToolInput = z.infer<typeof skillCaptureToolInputSchema>

const skillCaptureTool: AiToolDefinition<
  SkillCaptureToolInput,
  { skillId: string; promoted: boolean; skillVersionId?: string; versionNo?: number }
> = {
  name: 'skill_capture',
  description: 'Capture a reusable skill from tacit knowledge and optionally promote it.',
  inputSchema: skillCaptureToolInputSchema,
  requiredFeatures: ['agent_governance.tools.use', 'agent_governance.skills.manage'],
  handler: withPolicyAwareGrant(
    'skill_capture',
    () => ({ actionClass: 'write' }),
    async (input, ctx) => {
      const { tenantId, organizationId } = requireScope(ctx)

      const commandBus = ctx.container.resolve<CommandBus>('commandBus')
      const commandCtx = toCommandCtx(ctx)

      const useTraceCapture =
        Array.isArray(input.decisionEventIds) ||
        typeof input.postmortem === 'string' ||
        typeof input.actionType === 'string' ||
        typeof input.targetEntity === 'string'

      let skillId: string | null = null
      let promoted = false
      let skillVersionId: string | undefined
      let versionNo: number | undefined

      if (useTraceCapture) {
        const { result: captureResult } = await commandBus.execute('agent_governance.skills.capture_from_trace', {
          input: {
            tenantId,
            organizationId,
            name: input.name,
            description: input.description ?? null,
            decisionEventIds: input.decisionEventIds,
            actionType: input.actionType,
            targetEntity: input.targetEntity,
            targetId: input.targetId ?? null,
            postmortem: input.postmortem ?? null,
            sampleSize: 80,
            autoValidate: input.autoValidate,
            passRateThreshold: input.passRateThreshold,
            approvalDecision: input.approvalDecision,
            idempotencyKey: input.idempotencyKey,
          },
          ctx: commandCtx,
        })

        skillId = (captureResult as { skillId?: string }).skillId ?? null
      } else {
        if (!input.name) {
          throw new Error('name is required when trace capture context is not provided.')
        }

        const { result: createResult } = await commandBus.execute('agent_governance.skills.create', {
          input: {
            tenantId,
            organizationId,
            name: input.name,
            description: input.description ?? null,
            frameworkJson: input.frameworkJson ?? null,
            sourceType: input.sourceType ?? 'hybrid',
            status: input.status ?? 'draft',
          },
          ctx: commandCtx,
        })

        skillId = (createResult as { skillId?: string }).skillId ?? null
      }

      if (!skillId) {
        throw new Error('Skill creation failed: missing skill id in command result.')
      }

      if (input.promote) {
        await commandBus.execute('agent_governance.skills.validate', {
          input: {
            id: skillId,
            sampleSize: 80,
            passRateThreshold: input.passRateThreshold ?? 0.6,
            approvalDecision: 'approve',
            comment: 'Auto-validation via skill_capture tool before promotion.',
            idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:validate` : undefined,
          },
          ctx: commandCtx,
        })

        const { result: promoteResult } = await commandBus.execute('agent_governance.skills.promote', {
          input: {
            id: skillId,
            diffJson: null,
            validationReportJson: input.validationReportJson ?? null,
            idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:promote` : undefined,
          },
          ctx: commandCtx,
        })

        promoted = true
        skillVersionId = (promoteResult as { skillVersionId?: string }).skillVersionId
        versionNo = (promoteResult as { versionNo?: number }).versionNo
      }

      return {
        skillId,
        promoted,
        skillVersionId,
        versionNo,
      }
    },
  ),
}

export const aiTools = [
  runTool,
  riskCheckTool,
  precedentSearchTool,
  precedentExplainTool,
  contextExpandTool,
  skillCaptureTool,
  aliasTool(runTool, 'agent_governance_run', 'Deprecated alias for agent_run.'),
  aliasTool(riskCheckTool, 'agent_governance_risk_check', 'Deprecated alias for risk_check.'),
  aliasTool(precedentSearchTool, 'agent_governance_precedent_search', 'Deprecated alias for precedent_search.'),
  aliasTool(precedentExplainTool, 'agent_governance_precedent_explain', 'Deprecated alias for precedent_explain.'),
  aliasTool(contextExpandTool, 'agent_governance_context_expand', 'Deprecated alias for context_expand.'),
  aliasTool(skillCaptureTool, 'agent_governance_skill_capture', 'Deprecated alias for skill_capture.'),
]

export default aiTools
