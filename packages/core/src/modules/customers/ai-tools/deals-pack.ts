/**
 * `customers.list_deals` + `customers.get_deal` (Phase 1 WS-C, Step 3.9).
 * `customers.update_deal_stage` mutation tool (Phase 3 WS-C, Step 5.13).
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '#generated/entities.ids.generated'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerActivity,
  CustomerComment,
  CustomerEntity,
  CustomerPipelineStage,
} from '../data/entities'
import {
  assertTenantScope,
  type CustomersAiToolDefinition,
  type CustomersToolContext,
  type CustomersToolLoadBeforeSingleRecord,
} from './types'

function resolveEm(ctx: CustomersToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CustomersToolContext, tenantId: string) {
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

const listDealsTool: CustomersAiToolDefinition = {
  name: 'customers.list_deals',
  displayName: 'List deals',
  description:
    'Search / list deals for the caller tenant + organization. Optional filters include linked person / company / pipeline stage.',
  inputSchema: listDealsInput,
  requiredFeatures: ['customers.deals.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listDealsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    // NOTE: ILIKE queries don't work on encrypted fields. When q is set,
    // we first try ILIKE; if 0 results, fall back to in-memory filtering
    // on decrypted data. The fallback is added after the main query below.
    const searchQuery = input.q?.trim() || null
    if (searchQuery) {
      const pattern = `%${escapeLikePattern(searchQuery)}%`
      where.$or = [
        { title: { $ilike: pattern } },
        { description: { $ilike: pattern } },
      ]
    }
    if (input.pipelineStageId) where.pipelineStageId = input.pipelineStageId
    if (input.status) where.status = input.status

    let dealIdRestriction: string[] | null = null
    if (input.personId) {
      const personLinks = await findWithDecryption<CustomerDealPersonLink>(
        em,
        CustomerDealPersonLink,
        { person: input.personId } as any,
        undefined,
        buildScope(ctx, tenantId),
      )
      const ids = personLinks
        .map((link) => {
          const deal = (link as any).deal
          if (!deal) return null
          return typeof deal === 'string' ? deal : deal.id ?? null
        })
        .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
      dealIdRestriction = ids
    }
    if (input.companyId) {
      const companyLinks = await findWithDecryption<CustomerDealCompanyLink>(
        em,
        CustomerDealCompanyLink,
        { company: input.companyId } as any,
        undefined,
        buildScope(ctx, tenantId),
      )
      const ids = companyLinks
        .map((link) => {
          const deal = (link as any).deal
          if (!deal) return null
          return typeof deal === 'string' ? deal : deal.id ?? null
        })
        .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
      dealIdRestriction = dealIdRestriction
        ? dealIdRestriction.filter((id) => ids.includes(id))
        : ids
    }
    if (dealIdRestriction !== null) {
      if (dealIdRestriction.length === 0) {
        return { items: [], total: 0, limit, offset }
      }
      where.id = { $in: dealIdRestriction }
    }

    let [rows, total] = await Promise.all([
      findWithDecryption<CustomerDeal>(
        em,
        CustomerDeal,
        where as any,
        { limit, offset, orderBy: { createdAt: 'desc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CustomerDeal, where as any),
    ])

    // Encrypted-data fallback: ILIKE can't match encrypted fields. When the
    // text query returned 0 results, re-fetch all records and filter in memory
    // on the decrypted values. Practical for CRM-scale datasets (<10K).
    if (total === 0 && searchQuery && !dealIdRestriction) {
      const fallbackWhere: Record<string, unknown> = { tenantId, deletedAt: null }
      if (ctx.organizationId) fallbackWhere.organizationId = ctx.organizationId
      const allRows = await findWithDecryption<CustomerDeal>(
        em,
        CustomerDeal,
        fallbackWhere as any,
        { limit: 500, orderBy: { createdAt: 'desc' } as any } as any,
        buildScope(ctx, tenantId),
      )
      const lowerQ = searchQuery.toLowerCase()
      rows = allRows.filter((row) => {
        const title = (row.title ?? '').toLowerCase()
        const desc = (row.description ?? '').toLowerCase()
        return title.includes(lowerQ) || desc.includes(lowerQ)
      }).slice(0, limit)
      total = rows.length
    }

    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description ?? null,
        status: row.status ?? null,
        pipelineId: row.pipelineId ?? null,
        pipelineStageId: row.pipelineStageId ?? null,
        valueAmount: row.valueAmount ?? null,
        valueCurrency: row.valueCurrency ?? null,
        probability: row.probability ?? null,
        ownerUserId: row.ownerUserId ?? null,
        expectedCloseAt: row.expectedCloseAt ? new Date(row.expectedCloseAt).toISOString() : null,
        source: row.source ?? null,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      })),
      total,
      limit,
      offset,
    }
  },
}

const getDealInput = z.object({
  dealId: z.string().uuid().describe('Deal id (UUID).'),
  includeRelated: z
    .boolean()
    .optional()
    .describe('When true, include notes, activities, linked people and companies (each capped at 100).'),
})

const getDealTool: CustomersAiToolDefinition = {
  name: 'customers.get_deal',
  displayName: 'Get deal',
  description:
    'Fetch a deal by id with fields and (optionally) notes, activities, linked people, and linked companies. Returns { found: false } when outside tenant/org scope.',
  inputSchema: getDealInput,
  requiredFeatures: ['customers.deals.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = getDealInput.parse(rawInput)
    const em = resolveEm(ctx)
    const where: Record<string, unknown> = { id: input.dealId, tenantId, deletedAt: null }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const deal = await findOneWithDecryption<CustomerDeal>(
      em,
      CustomerDeal,
      where as any,
      undefined,
      buildScope(ctx, tenantId),
    )
    if (!deal || deal.tenantId !== tenantId) {
      return { found: false as const, dealId: input.dealId }
    }
    const customFieldValues = await loadCustomFieldValues({
      em,
      entityId: E.customers.customer_deal,
      recordIds: [deal.id],
      tenantIdByRecord: { [deal.id]: deal.tenantId ?? null },
      organizationIdByRecord: { [deal.id]: deal.organizationId ?? null },
      tenantFallbacks: [deal.tenantId ?? tenantId].filter((value): value is string => !!value),
    })
    const customFields = customFieldValues[deal.id] ?? {}

    let related: Record<string, unknown> | null = null
    if (input.includeRelated) {
      const scope = buildScope(ctx, tenantId)
      const [activities, comments, personLinks, companyLinks] = await Promise.all([
        findWithDecryption<CustomerActivity>(
          em,
          CustomerActivity,
          { tenantId, deal: deal.id } as any,
          { limit: 100, orderBy: { occurredAt: 'desc', createdAt: 'desc' } as any } as any,
          scope,
        ),
        findWithDecryption<CustomerComment>(
          em,
          CustomerComment,
          { tenantId, deal: deal.id } as any,
          { limit: 100, orderBy: { createdAt: 'desc' } as any } as any,
          scope,
        ),
        findWithDecryption<CustomerDealPersonLink>(
          em,
          CustomerDealPersonLink,
          { deal: deal.id } as any,
          { populate: ['person'] as any } as any,
          scope,
        ),
        findWithDecryption<CustomerDealCompanyLink>(
          em,
          CustomerDealCompanyLink,
          { deal: deal.id } as any,
          { populate: ['company'] as any } as any,
          scope,
        ),
      ])
      related = {
        activities: activities.map((activity) => ({
          id: activity.id,
          activityType: activity.activityType,
          subject: activity.subject ?? null,
          body: activity.body ?? null,
          occurredAt: activity.occurredAt ? new Date(activity.occurredAt).toISOString() : null,
          createdAt: activity.createdAt ? new Date(activity.createdAt).toISOString() : null,
        })),
        notes: comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          authorUserId: comment.authorUserId ?? null,
          createdAt: comment.createdAt ? new Date(comment.createdAt).toISOString() : null,
        })),
        people: personLinks
          .map((link) => {
            const person = (link as any).person as CustomerEntity | null
            if (!person || person.deletedAt) return null
            return {
              id: person.id,
              displayName: person.displayName,
              primaryEmail: person.primaryEmail ?? null,
              primaryPhone: person.primaryPhone ?? null,
              participantRole: link.participantRole ?? null,
            }
          })
          .filter((value): value is { id: string; displayName: string; primaryEmail: string | null; primaryPhone: string | null; participantRole: string | null } => value !== null),
        companies: companyLinks
          .map((link) => {
            const company = (link as any).company as CustomerEntity | null
            if (!company || company.deletedAt) return null
            return {
              id: company.id,
              displayName: company.displayName,
              primaryEmail: company.primaryEmail ?? null,
              primaryPhone: company.primaryPhone ?? null,
            }
          })
          .filter((value): value is { id: string; displayName: string; primaryEmail: string | null; primaryPhone: string | null } => value !== null),
      }
    }
    return {
      found: true as const,
      deal: {
        id: deal.id,
        title: deal.title,
        description: deal.description ?? null,
        status: deal.status ?? null,
        pipelineId: deal.pipelineId ?? null,
        pipelineStageId: deal.pipelineStageId ?? null,
        valueAmount: deal.valueAmount ?? null,
        valueCurrency: deal.valueCurrency ?? null,
        probability: deal.probability ?? null,
        ownerUserId: deal.ownerUserId ?? null,
        expectedCloseAt: deal.expectedCloseAt ? new Date(deal.expectedCloseAt).toISOString() : null,
        source: deal.source ?? null,
        organizationId: deal.organizationId ?? null,
        tenantId: deal.tenantId ?? null,
        createdAt: deal.createdAt ? new Date(deal.createdAt).toISOString() : null,
        updatedAt: deal.updatedAt ? new Date(deal.updatedAt).toISOString() : null,
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
