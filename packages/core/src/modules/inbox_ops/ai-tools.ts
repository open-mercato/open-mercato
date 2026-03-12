import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { runWithCacheTenant } from '@open-mercato/cache'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  resolveOpenCodeModel,
  resolveOpenCodeProviderApiKey,
} from '@open-mercato/shared/lib/ai/opencode-provider'
import { InboxProposal, InboxProposalAction, InboxDiscrepancy } from './data/entities'
import { inboxProposalCategoryEnum } from './data/validators'
import { executeAction } from './lib/executionEngine'
import { resolveExtractionProviderId, createStructuredModel, withTimeout } from './lib/llmProvider'
import { resolveOptionalEventBus } from './lib/eventBus'

type ToolContext = {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
}

interface AiToolDefinition {
  name: string
  description: string
  inputSchema: z.ZodType
  requiredFeatures?: string[]
  handler: (input: never, ctx: ToolContext) => Promise<unknown>
}

// =============================================================================
// Helpers
// =============================================================================

function requireTenantContext(ctx: ToolContext): { tenantId: string; organizationId: string } {
  if (!ctx.tenantId || !ctx.organizationId) {
    throw new Error('Tenant context is required')
  }
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

function resolveCrossModuleEntities(container: ToolContext['container']) {
  const entities: Record<string, unknown> = {}
  const keys = [
    'CustomerEntity',
    'SalesOrder',
    'SalesShipment',
    'SalesChannel',
    'Dictionary',
    'DictionaryEntry',
  ]
  for (const key of keys) {
    try {
      entities[key] = container.resolve(key)
    } catch {
      /* module not available */
    }
  }
  return entities
}

// =============================================================================
// inbox_ops_list_proposals — Query proposals by status, category, date range
// =============================================================================

const listProposalsTool = {
  name: 'inbox_ops_list_proposals',
  description: `List inbox proposals with optional filters by status, category, and date range.

Returns: total count and an array of proposals with id, summary, status, category, confidence, actionCount, and createdAt.`,
  inputSchema: z.object({
    status: z
      .enum(['pending', 'partial', 'accepted', 'rejected'])
      .optional()
      .describe('Filter by proposal status'),
    category: inboxProposalCategoryEnum
      .optional()
      .describe('Filter by email category'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .default(10)
      .describe('Maximum number of proposals to return (default: 10)'),
    dateFrom: z
      .string()
      .optional()
      .describe('Filter proposals created on or after this date (ISO 8601)'),
    dateTo: z
      .string()
      .optional()
      .describe('Filter proposals created on or before this date (ISO 8601)'),
  }),
  requiredFeatures: ['inbox_ops.proposals.view'],
  handler: async (input: { status?: string; category?: string; limit?: number; dateFrom?: string; dateTo?: string }, ctx: ToolContext) => {
    const scope = requireTenantContext(ctx)
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const where: Record<string, unknown> = {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      isActive: true,
      deletedAt: null,
    }

    if (input.status) {
      where.status = input.status
    }
    if (input.category) {
      where.category = input.category
    }
    if (input.dateFrom || input.dateTo) {
      const createdAt: Record<string, unknown> = {}
      if (input.dateFrom) {
        createdAt.$gte = new Date(input.dateFrom)
      }
      if (input.dateTo) {
        createdAt.$lte = new Date(input.dateTo)
      }
      where.createdAt = createdAt
    }

    const proposals = await findWithDecryption(
      em,
      InboxProposal,
      where,
      { orderBy: { createdAt: 'DESC' }, limit: input.limit },
      scope,
    )

    // Count actions per proposal in a single query
    const proposalIds = proposals.map((p) => p.id)
    const actionCountMap = new Map<string, number>()

    if (proposalIds.length > 0) {
      const actions = await findWithDecryption(
        em,
        InboxProposalAction,
        {
          proposalId: { $in: proposalIds },
          deletedAt: null,
        },
        undefined,
        scope,
      )
      for (const action of actions) {
        actionCountMap.set(action.proposalId, (actionCountMap.get(action.proposalId) ?? 0) + 1)
      }
    }

    // Get total count for the filter
    const total = await em.count(InboxProposal, where)

    return {
      total,
      proposals: proposals.map((p) => ({
        id: p.id,
        summary: p.summary,
        status: p.status,
        category: p.category ?? null,
        confidence: Number(p.confidence),
        actionCount: actionCountMap.get(p.id) ?? 0,
        createdAt: p.createdAt.toISOString(),
      })),
    }
  },
}

// =============================================================================
// inbox_ops_get_proposal — Fetch proposal detail with actions and discrepancies
// =============================================================================

const getProposalTool = {
  name: 'inbox_ops_get_proposal',
  description: `Get full details of an inbox proposal including its actions and discrepancies.

Returns: proposal with id, summary, status, category, confidence, actions array, and discrepancies array.`,
  inputSchema: z.object({
    proposalId: z.string().uuid().describe('The UUID of the proposal to retrieve'),
  }),
  requiredFeatures: ['inbox_ops.proposals.view'],
  handler: async (input: { proposalId: string }, ctx: ToolContext) => {
    const scope = requireTenantContext(ctx)
    const em = ctx.container.resolve<EntityManager>('em').fork()

    const proposal = await findOneWithDecryption(
      em,
      InboxProposal,
      {
        id: input.proposalId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        isActive: true,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    if (!proposal) {
      return { error: 'Proposal not found' }
    }

    const actions = await findWithDecryption(
      em,
      InboxProposalAction,
      {
        proposalId: proposal.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      { orderBy: { sortOrder: 'ASC' } },
      scope,
    )

    const discrepancies = await findWithDecryption(
      em,
      InboxDiscrepancy,
      {
        proposalId: proposal.id,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      },
      undefined,
      scope,
    )

    return {
      proposal: {
        id: proposal.id,
        summary: proposal.summary,
        status: proposal.status,
        category: proposal.category ?? null,
        confidence: Number(proposal.confidence),
        actions: actions.map((a) => ({
          id: a.id,
          actionType: a.actionType,
          description: a.description,
          status: a.status,
          confidence: Number(a.confidence),
          requiredFeature: a.requiredFeature ?? null,
          sortOrder: a.sortOrder,
          createdEntityId: a.createdEntityId ?? null,
          createdEntityType: a.createdEntityType ?? null,
        })),
        discrepancies: discrepancies.map((d) => ({
          id: d.id,
          type: d.type,
          severity: d.severity,
          description: d.description,
          expectedValue: d.expectedValue ?? null,
          foundValue: d.foundValue ?? null,
          resolved: d.resolved,
        })),
      },
    }
  },
}

// =============================================================================
// inbox_ops_accept_action — Accept and execute a specific action
// =============================================================================

const acceptActionTool = {
  name: 'inbox_ops_accept_action',
  description: `Accept and execute a specific action from an inbox proposal. Creates the entity in the target module (e.g., order, contact).

Returns on success: { ok: true, createdEntityId, createdEntityType }
Returns on error: error message with appropriate detail.`,
  inputSchema: z.object({
    proposalId: z.string().uuid().describe('The UUID of the proposal'),
    actionId: z.string().uuid().describe('The UUID of the action to accept'),
  }),
  requiredFeatures: ['inbox_ops.proposals.manage'],
  handler: async (input: { proposalId: string; actionId: string }, ctx: ToolContext) => {
    const scope = requireTenantContext(ctx)
    if (!ctx.userId) {
      throw new Error('User context is required')
    }

    const em = ctx.container.resolve<EntityManager>('em').fork()

    const action = await findOneWithDecryption(
      em,
      InboxProposalAction,
      {
        id: input.actionId,
        proposalId: input.proposalId,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    if (!action) {
      return { error: 'Action not found' }
    }

    // Check if action was already processed
    if (action.status !== 'pending' && action.status !== 'failed') {
      return { error: 'Action already processed', status: action.status }
    }

    // Check target module permission
    if (action.requiredFeature) {
      const hasFeature =
        ctx.isSuperAdmin || ctx.userFeatures.includes(action.requiredFeature)
      if (!hasFeature) {
        return {
          error: 'Insufficient permissions',
          requiredFeature: action.requiredFeature,
        }
      }
    }

    const entities = resolveCrossModuleEntities(ctx.container)
    const eventBus = resolveOptionalEventBus(ctx.container)

    const result = await executeAction(action, {
      em,
      userId: ctx.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      eventBus,
      container: ctx.container,
      entities: entities as unknown as import('./lib/executionEngine').CrossModuleEntities,
    })

    if (!result.success) {
      if (result.statusCode === 409) {
        return { error: 'Action already processed', status: 'accepted' }
      }
      if (result.statusCode === 403) {
        return {
          error: 'Insufficient permissions',
          requiredFeature: action.requiredFeature ?? 'unknown',
        }
      }
      return { error: 'Execution failed', detail: result.error ?? 'Unknown error' }
    }

    try {
      const { resolveCache, invalidateCountsCache } = await import('./lib/cache')
      const cache = resolveCache(ctx.container)
      if (cache && scope.tenantId) {
        await runWithCacheTenant(scope.tenantId, () => invalidateCountsCache(cache, scope.tenantId))
      }
    } catch { /* cache invalidation is non-critical */ }

    return {
      ok: true,
      createdEntityId: result.createdEntityId ?? null,
      createdEntityType: result.createdEntityType ?? null,
    }
  },
}

// =============================================================================
// inbox_ops_categorize_email — Standalone LLM-based text categorization
// =============================================================================

const categorizeEmailSchema = z.object({
  category: inboxProposalCategoryEnum,
  confidence: z.number(),
  reasoning: z.string(),
})

const categorizeEmailTool = {
  name: 'inbox_ops_categorize_email',
  description: `Categorize email or text content using AI. Classifies text into one of: rfq, order, order_update, complaint, shipping_update, inquiry, payment, other.

Returns: { category, confidence (0-1), reasoning }
Input text is limited to 10,000 characters for cost control.`,
  inputSchema: z.object({
    text: z
      .string()
      .min(1)
      .max(10000)
      .describe('Email or text content to categorize (max 10K chars)'),
  }),
  requiredFeatures: ['inbox_ops.proposals.view'],
  handler: async (input: { text: string }, ctx: ToolContext) => {
    requireTenantContext(ctx)

    const providerId = resolveExtractionProviderId()
    const apiKey = resolveOpenCodeProviderApiKey(providerId)
    if (!apiKey) {
      throw new Error(`Missing API key for provider "${providerId}"`)
    }

    const modelConfig = resolveOpenCodeModel(providerId, {})
    const model = await createStructuredModel(providerId, apiKey, modelConfig.modelId)

    const { generateObject } = await import('ai')

    const result = await withTimeout(
      generateObject({
        model,
        schema: categorizeEmailSchema,
        system: `You are an email classification agent. Classify the given text into exactly one category:
- rfq: Request for quotation or pricing inquiry
- order: New purchase order or order placement
- order_update: Change or update to an existing order
- complaint: Customer complaint, dispute, or dissatisfaction
- shipping_update: Shipment status, tracking, or delivery information
- inquiry: General question or information request
- payment: Payment-related (invoice, receipt, payment terms)
- other: Does not fit any category above

Return a JSON object with:
- category: one of the categories above
- confidence: a number between 0 and 1 indicating how confident you are
- reasoning: a brief explanation (1-2 sentences) of why this category was chosen`,
        prompt: input.text,
        temperature: 0,
      }),
      15000,
      'Email categorization timed out after 15s',
    )

    return {
      category: result.object.category,
      confidence: Math.round(result.object.confidence * 100) / 100,
      reasoning: result.object.reasoning,
    }
  },
}

// =============================================================================
// Export
// =============================================================================

/**
 * All AI tools exported by the inbox_ops module.
 * Discovered by ai-assistant module's generator.
 */
export const aiTools: AiToolDefinition[] = [
  listProposalsTool,
  getProposalTool,
  acceptActionTool,
  categorizeEmailTool,
]

export default aiTools
