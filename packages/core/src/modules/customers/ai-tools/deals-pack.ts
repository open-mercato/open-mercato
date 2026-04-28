/**
 * `customers.list_deals` + `customers.get_deal` (Phase 1 WS-C, Step 3.9).
 * `customers.update_deal_stage` mutation tool (Phase 3 WS-C, Step 5.13).
 *
 * Phase 3a of `.ai/specs/2026-04-27-ai-tools-api-backed-dry-refactor.md`:
 * `customers.list_deals` is now an API-backed wrapper over
 * `GET /api/customers/deals`. Tool name, schema, requiredFeatures, and output
 * shape are unchanged.
 *
 * Phase 3c of the same spec migrates `customers.get_deal` to the documented
 * aggregate detail route. The handler issues 1 call without `includeRelated`
 * (`GET /customers/deals/<id>`) and 3 bounded calls with `includeRelated`
 * (deal detail + activities + comments by `dealId`). The 3-call cap matches
 * the spec's residual N+1 budget; deeper aggregation can earn a first-class
 * API later without touching the AI surface.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import {
  createAiApiOperationRunner,
  type AiApiOperationRequest,
  type AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  CustomerDeal,
  CustomerPipelineStage,
} from '../data/entities'
import {
  assertTenantScope,
  type CustomersAiToolDefinition,
  type CustomersToolContext,
  type CustomersToolLoadBeforeSingleRecord,
} from './types'

function resolveEm(ctx: CustomersToolContext | AiToolExecutionContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CustomersToolContext | AiToolExecutionContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const listDealsInput = z
  .object({
    q: z.string().trim().optional().describe('Search text matched against deal title / description. Omit or leave empty to list all.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum rows to return (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Number of rows to skip (default 0).'),
    personId: z.string().uuid().optional().describe('Return only deals linked to this person entity id.'),
    companyId: z.string().uuid().optional().describe('Return only deals linked to this company entity id.'),
    pipelineStageId: z.string().uuid().optional().describe('Return only deals at this pipeline stage.'),
    status: z.string().optional().describe('Filter by deal status (e.g. "open", "won", "lost").'),
  })
  .passthrough()

type ListDealsInput = z.infer<typeof listDealsInput>

type ListDealsApiItem = {
  id?: string
  title?: string | null
  description?: string | null
  status?: string | null
  pipeline_id?: string | null
  pipelineId?: string | null
  pipeline_stage_id?: string | null
  pipelineStageId?: string | null
  value_amount?: string | number | null
  valueAmount?: string | number | null
  value_currency?: string | null
  valueCurrency?: string | null
  probability?: number | null
  owner_user_id?: string | null
  ownerUserId?: string | null
  expected_close_at?: string | null
  expectedCloseAt?: string | null
  source?: string | null
  organization_id?: string | null
  organizationId?: string | null
  tenant_id?: string | null
  tenantId?: string | null
  created_at?: string | null
  createdAt?: string | null
}

type ListDealsApiResponse = {
  items?: ListDealsApiItem[]
  total?: number
}

type ListDealsOutput = {
  items: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}

const listDealsTool = defineApiBackedAiTool<ListDealsInput, ListDealsApiResponse, ListDealsOutput>({
  name: 'customers.list_deals',
  displayName: 'List deals',
  description:
    'Search / list deals for the caller tenant + organization. Optional filters include linked person / company / pipeline stage.',
  inputSchema: listDealsInput,
  requiredFeatures: ['customers.deals.view'],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx as unknown as CustomersToolContext)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const page = Math.floor(offset / limit) + 1

    const query: Record<string, string | number | boolean | null | undefined> = {
      page,
      pageSize: limit,
    }
    if (input.q?.trim()) query.search = input.q.trim()
    if (input.personId) query.personId = input.personId
    if (input.companyId) query.companyId = input.companyId
    if (input.pipelineStageId) query.pipelineStageId = input.pipelineStageId
    if (input.status) query.status = input.status

    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: '/customers/deals',
      query,
    }
    return operation
  },
  mapResponse: (response, input) => {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const data = (response.data ?? {}) as ListDealsApiResponse
    const rawItems: ListDealsApiItem[] = Array.isArray(data.items) ? data.items : []
    return {
      items: rawItems.map((row) => {
        const expectedCloseRaw = row.expected_close_at ?? row.expectedCloseAt ?? null
        const expectedCloseAt = expectedCloseRaw ? new Date(String(expectedCloseRaw)).toISOString() : null
        const createdAtRaw = row.created_at ?? row.createdAt ?? null
        const createdAt = createdAtRaw ? new Date(String(createdAtRaw)).toISOString() : null
        return {
          id: row.id,
          title: row.title ?? null,
          description: row.description ?? null,
          status: row.status ?? null,
          pipelineId: row.pipeline_id ?? row.pipelineId ?? null,
          pipelineStageId: row.pipeline_stage_id ?? row.pipelineStageId ?? null,
          valueAmount: row.value_amount ?? row.valueAmount ?? null,
          valueCurrency: row.value_currency ?? row.valueCurrency ?? null,
          probability: row.probability ?? null,
          ownerUserId: row.owner_user_id ?? row.ownerUserId ?? null,
          expectedCloseAt,
          source: row.source ?? null,
          organizationId: row.organization_id ?? row.organizationId ?? null,
          tenantId: row.tenant_id ?? row.tenantId ?? null,
          createdAt,
        }
      }),
      total: typeof data.total === 'number' ? data.total : 0,
      limit,
      offset,
    }
  },
}) as unknown as CustomersAiToolDefinition

const getDealInput = z.object({
  dealId: z.string().uuid().describe('Deal id (UUID).'),
  includeRelated: z
    .boolean()
    .optional()
    .describe('When true, include notes, activities, linked people and companies (each capped at 100).'),
})

type GetDealInput = z.infer<typeof getDealInput>

function toIsoDeal(value: unknown): string | null {
  if (!value) return null
  const dt = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

const getDealTool: CustomersAiToolDefinition = {
  name: 'customers.get_deal',
  displayName: 'Get deal',
  description:
    'Fetch a deal by id with fields and (optionally) notes, activities, linked people, and linked companies. Returns { found: false } when outside tenant/org scope.',
  inputSchema: getDealInput,
  requiredFeatures: ['customers.deals.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId: _tenantId } = assertTenantScope(ctx)
    void _tenantId
    const input: GetDealInput = getDealInput.parse(rawInput)
    const includeRelated = !!input.includeRelated
    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)

    const detailResponse = await runner.run<Record<string, unknown>>({
      method: 'GET',
      path: `/customers/deals/${input.dealId}`,
    })
    if (!detailResponse.success) {
      if (detailResponse.statusCode === 404 || detailResponse.statusCode === 403) {
        return { found: false as const, dealId: input.dealId }
      }
      throw new Error(detailResponse.error ?? `Failed to fetch deal ${input.dealId}`)
    }
    const detail = (detailResponse.data ?? {}) as Record<string, unknown>
    const dealRow = (detail.deal ?? null) as Record<string, unknown> | null
    if (!dealRow) {
      return { found: false as const, dealId: input.dealId }
    }
    const customFields = (detail.customFields ?? {}) as Record<string, unknown>
    const peopleRows = Array.isArray(detail.people) ? (detail.people as Array<Record<string, unknown>>) : []
    const companiesRows = Array.isArray(detail.companies)
      ? (detail.companies as Array<Record<string, unknown>>)
      : []

    let related: Record<string, unknown> | null = null
    if (includeRelated) {
      const [activitiesResponse, commentsResponse] = await Promise.all([
        runner.run<{ items?: Array<Record<string, unknown>>; total?: number }>({
          method: 'GET',
          path: '/customers/activities',
          query: { dealId: input.dealId, page: 1, pageSize: 100, sortField: 'occurredAt', sortDir: 'desc' },
        }),
        runner.run<{ items?: Array<Record<string, unknown>>; total?: number }>({
          method: 'GET',
          path: '/customers/comments',
          query: { dealId: input.dealId, page: 1, pageSize: 100 },
        }),
      ])
      const activities =
        activitiesResponse.success && Array.isArray(activitiesResponse.data?.items)
          ? (activitiesResponse.data!.items as Array<Record<string, unknown>>)
          : []
      const comments =
        commentsResponse.success && Array.isArray(commentsResponse.data?.items)
          ? (commentsResponse.data!.items as Array<Record<string, unknown>>)
          : []

      related = {
        activities: activities.map((activity) => ({
          id: activity.id,
          activityType: activity.activityType ?? activity.activity_type ?? null,
          subject: activity.subject ?? null,
          body: activity.body ?? null,
          occurredAt: toIsoDeal(activity.occurredAt ?? activity.occurred_at),
          createdAt: toIsoDeal(activity.createdAt ?? activity.created_at),
        })),
        notes: comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          authorUserId: comment.authorUserId ?? comment.author_user_id ?? null,
          createdAt: toIsoDeal(comment.createdAt ?? comment.created_at),
        })),
        people: peopleRows
          .map((person) => {
            if (!person || typeof person !== 'object') return null
            const id = typeof person.id === 'string' ? person.id : null
            if (!id) return null
            const subtitle = typeof person.subtitle === 'string' ? person.subtitle : null
            const label = typeof person.label === 'string' ? person.label : ''
            return {
              id,
              displayName: label,
              primaryEmail: subtitle && subtitle.includes('@') ? subtitle : null,
              primaryPhone: subtitle && !subtitle.includes('@') ? subtitle : null,
              participantRole: null,
            }
          })
          .filter(
            (value): value is {
              id: string
              displayName: string
              primaryEmail: string | null
              primaryPhone: string | null
              participantRole: string | null
            } => value !== null,
          ),
        companies: companiesRows
          .map((company) => {
            if (!company || typeof company !== 'object') return null
            const id = typeof company.id === 'string' ? company.id : null
            if (!id) return null
            const label = typeof company.label === 'string' ? company.label : ''
            return {
              id,
              displayName: label,
              primaryEmail: null,
              primaryPhone: null,
            }
          })
          .filter(
            (value): value is {
              id: string
              displayName: string
              primaryEmail: string | null
              primaryPhone: string | null
            } => value !== null,
          ),
      }
    }

    return {
      found: true as const,
      deal: {
        id: dealRow.id,
        title: typeof dealRow.title === 'string' ? dealRow.title : '',
        description: dealRow.description ?? null,
        status: dealRow.status ?? null,
        pipelineId: dealRow.pipelineId ?? null,
        pipelineStageId: dealRow.pipelineStageId ?? null,
        valueAmount: dealRow.valueAmount ?? null,
        valueCurrency: dealRow.valueCurrency ?? null,
        probability: dealRow.probability ?? null,
        ownerUserId: dealRow.ownerUserId ?? null,
        expectedCloseAt: toIsoDeal(dealRow.expectedCloseAt),
        source: dealRow.source ?? null,
        organizationId: dealRow.organizationId ?? null,
        tenantId: dealRow.tenantId ?? null,
        createdAt: toIsoDeal(dealRow.createdAt),
        updatedAt: toIsoDeal(dealRow.updatedAt),
      },
      customFields,
      related,
    }
  },
}

/**
 * Mutation tool: move a deal to a different pipeline stage. Step 5.13 — first
 * mutation-capable flow on the pending-action contract.
 *
 * Accepts either `toPipelineStageId` (UUID — preferred, tenant-scoped stage
 * record) or `toStage` (free-form string that maps to `CustomerDeal.status`
 * for pipeline roots like `open`/`won`/`lost`). Exactly one must be provided.
 *
 * The handler delegates to the existing `customers.deals.update` command so
 * all side effects (audit log, `customers.deal.updated` event, query index
 * refresh, notifications) stay identical to a direct API write.
 */
const updateDealStageInput = z
  .object({
    dealId: z.string().uuid().describe('Deal id (UUID) to update.'),
    toPipelineStageId: z
      .string()
      .uuid()
      .optional()
      .describe('Target pipeline stage id (UUID). Preferred — tenant-scoped stage record.'),
    toStage: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .optional()
      .describe(
        'Target status slug (e.g. "open", "won", "lost"). Used when the deal does not belong to a managed pipeline.',
      ),
  })
  .refine(
    (value) => Boolean(value.toPipelineStageId) !== Boolean(value.toStage),
    {
      message: 'Provide exactly one of toPipelineStageId or toStage.',
      path: ['toPipelineStageId'],
    },
  )

type UpdateDealStageInput = z.infer<typeof updateDealStageInput>

function recordVersionFromUpdatedAt(updatedAt: Date | null | undefined): string | null {
  if (!updatedAt) return null
  const value = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  if (Number.isNaN(value.getTime())) return null
  return value.toISOString()
}

async function loadDealWithStage(
  em: EntityManager,
  ctx: CustomersToolContext,
  tenantId: string,
  dealId: string,
): Promise<CustomerDeal | null> {
  const where: Record<string, unknown> = { id: dealId, tenantId, deletedAt: null }
  if (ctx.organizationId) where.organizationId = ctx.organizationId
  const deal = await findOneWithDecryption<CustomerDeal>(
    em,
    CustomerDeal,
    where as any,
    undefined,
    buildScope(ctx, tenantId),
  )
  if (!deal || deal.tenantId !== tenantId) return null
  if (ctx.organizationId && deal.organizationId !== ctx.organizationId) return null
  return deal
}

function buildAuthContextFromTool(ctx: CustomersToolContext, tenantId: string): AuthContext {
  return {
    sub: ctx.userId ?? 'ai-agent',
    tenantId,
    orgId: ctx.organizationId ?? null,
    roles: [],
    isApiKey: false,
  } as AuthContext
}

const updateDealStageTool: CustomersAiToolDefinition = {
  name: 'customers.update_deal_stage',
  displayName: 'Update deal stage',
  description:
    'Move a deal to a different pipeline stage (by stage id) or change its top-level status (e.g. "open", "won", "lost"). Mutation tool — flows through the AI pending-action approval gate.',
  inputSchema: updateDealStageInput as z.ZodType<unknown>,
  requiredFeatures: ['customers.deals.manage'],
  tags: ['write', 'customers'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx): Promise<CustomersToolLoadBeforeSingleRecord | null> => {
    const { tenantId } = assertTenantScope(ctx)
    const input: UpdateDealStageInput = updateDealStageInput.parse(rawInput)
    const em = resolveEm(ctx)
    const deal = await loadDealWithStage(em, ctx, tenantId, input.dealId)
    if (!deal) return null
    return {
      recordId: deal.id,
      entityType: 'customers.deal',
      recordVersion: recordVersionFromUpdatedAt(deal.updatedAt),
      before: {
        status: deal.status ?? null,
        pipelineStage: deal.pipelineStage ?? null,
        pipelineStageId: deal.pipelineStageId ?? null,
      },
    }
  },
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input: UpdateDealStageInput = updateDealStageInput.parse(rawInput)
    const em = resolveEm(ctx)
    const deal = await loadDealWithStage(em, ctx, tenantId, input.dealId)
    if (!deal) {
      throw new Error(`Deal "${input.dealId}" is not accessible to the caller.`)
    }
    const organizationId = deal.organizationId
    if (!organizationId) {
      throw new Error(`Deal "${input.dealId}" has no organization scope.`)
    }

    const before = {
      status: deal.status ?? null,
      pipelineStage: deal.pipelineStage ?? null,
      pipelineStageId: deal.pipelineStageId ?? null,
    }

    const commandInput: Record<string, unknown> = {
      id: deal.id,
      tenantId,
      organizationId,
    }
    if (input.toPipelineStageId) {
      const stage = await em.findOne(CustomerPipelineStage, { id: input.toPipelineStageId })
      if (!stage) {
        throw new Error(`Pipeline stage "${input.toPipelineStageId}" not found.`)
      }
      commandInput.pipelineStageId = input.toPipelineStageId
    } else if (input.toStage) {
      commandInput.status = input.toStage
    }

    const commandBus = ctx.container.resolve<CommandBus>('commandBus')
    const commandRuntimeCtx: CommandRuntimeContext = {
      container: ctx.container,
      auth: buildAuthContextFromTool(ctx, tenantId),
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    }
    await commandBus.execute<Record<string, unknown>, { dealId: string }>(
      'customers.deals.update',
      { input: commandInput, ctx: commandRuntimeCtx },
    )

    const after = await loadDealWithStage(em, ctx, tenantId, deal.id)
    return {
      recordId: deal.id,
      commandName: 'customers.deals.update',
      before,
      after: after
        ? {
            status: after.status ?? null,
            pipelineStage: after.pipelineStage ?? null,
            pipelineStageId: after.pipelineStageId ?? null,
          }
        : null,
    }
  },
}

export const dealsAiTools: CustomersAiToolDefinition[] = [listDealsTool, getDealTool, updateDealStageTool]

export default dealsAiTools
