/**
 * `customers.list_companies` + `customers.get_company` (Phase 1 WS-C, Step 3.9).
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { type QueryEngine, type QueryResult, SortDir } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import {
  CustomerEntity,
  CustomerCompanyProfile,
  CustomerPersonProfile,
  CustomerAddress,
  CustomerActivity,
  CustomerComment,
  CustomerTodoLink,
  CustomerInteraction,
  CustomerDealCompanyLink,
  CustomerTagAssignment,
  CustomerTag,
} from '../data/entities'
import { assertTenantScope, type CustomersAiToolDefinition, type CustomersToolContext } from './types'

function resolveEm(ctx: CustomersToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CustomersToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const listCompaniesInput = z
  .object({
    q: z.string().trim().optional().describe('Search text matched against display name / email / domain. Omit or leave empty to list all.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum rows to return (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Number of rows to skip (default 0).'),
    tags: z.array(z.string().uuid()).optional().describe('Restrict to companies carrying at least one of these tag ids.'),
  })
  .passthrough()

const listCompaniesTool: CustomersAiToolDefinition = {
  name: 'customers.list_companies',
  displayName: 'List companies',
  description:
    'Search / list companies for the caller tenant + organization. Returns { items, total, limit, offset }.',
  inputSchema: listCompaniesInput,
  requiredFeatures: ['customers.companies.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listCompaniesInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0

    let idRestriction: string[] | null = null
    if (input.tags && input.tags.length > 0) {
      const assignments = await findWithDecryption<CustomerTagAssignment>(
        em,
        CustomerTagAssignment,
        { tenantId, tag: { $in: input.tags } } as any,
        undefined,
        buildScope(ctx, tenantId),
      )
      const scopedIds = assignments
        .map((assignment) => {
          const entity = (assignment as any).entity
          if (!entity) return null
          return typeof entity === 'string' ? entity : entity.id ?? null
        })
        .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
      if (!scopedIds.length) {
        return { items: [], total: 0, limit, offset }
      }
      idRestriction = scopedIds
    }

    const filters: Record<string, unknown> = {
      kind: 'company',
    }
    if (input.q?.trim()) {
      const pattern = `%${input.q.trim()}%`
      filters.$or = [
        { display_name: { $ilike: pattern } },
        { primary_email: { $ilike: pattern } },
        { description: { $ilike: pattern } },
      ]
    }
    if (idRestriction) {
      filters.id = { $in: idRestriction }
    }

    const qe = ctx.container.resolve<QueryEngine>('queryEngine')
    const result: QueryResult = await qe.query('customers:customer_entity', {
      filters,
      sort: [{ field: 'created_at', dir: SortDir.Desc }],
      page: { page: Math.floor(offset / limit) + 1, pageSize: limit },
      tenantId,
      organizationId: ctx.organizationId ?? undefined,
    })

    const entityIds = result.items
      .map((row: Record<string, unknown>) => row.id as string)
      .filter((id): id is string => typeof id === 'string')
    const profileMap = new Map<string, CustomerCompanyProfile>()
    if (entityIds.length > 0) {
      const profiles = await findWithDecryption<CustomerCompanyProfile>(
        em,
        CustomerCompanyProfile,
        { tenantId, entity: { $in: entityIds } } as any,
        undefined,
        buildScope(ctx, tenantId),
      )
      for (const profile of profiles) {
        const entityRef = (profile as any).entity
        const entityId = typeof entityRef === 'string' ? entityRef : entityRef?.id ?? null
        if (entityId) profileMap.set(entityId, profile)
      }
    }

    return {
      items: result.items.map((row: Record<string, unknown>) => {
        const profile = profileMap.get(row.id as string)
        return {
          id: row.id,
          displayName: row.display_name ?? row.displayName,
          primaryEmail: row.primary_email ?? row.primaryEmail ?? null,
          primaryPhone: row.primary_phone ?? row.primaryPhone ?? null,
          status: row.status ?? null,
          lifecycleStage: row.lifecycle_stage ?? row.lifecycleStage ?? null,
          source: row.source ?? null,
          ownerUserId: row.owner_user_id ?? row.ownerUserId ?? null,
          organizationId: row.organization_id ?? row.organizationId ?? null,
          tenantId: row.tenant_id ?? row.tenantId ?? null,
          domain: profile?.domain ?? null,
          websiteUrl: profile?.websiteUrl ?? null,
          industry: profile?.industry ?? null,
          sizeBucket: profile?.sizeBucket ?? null,
          createdAt: row.created_at ?? row.createdAt ? new Date(String(row.created_at ?? row.createdAt)).toISOString() : null,
        }
      }),
      total: result.total,
      limit,
      offset,
    }
  },
}

const getCompanyInput = z.object({
  companyId: z.string().uuid().describe('Company entity id (UUID).'),
  includeRelated: z
    .boolean()
    .optional()
    .describe('When true, include notes, activities, deals, people, addresses, tasks, and tags (each capped at 100).'),
})

const getCompanyTool: CustomersAiToolDefinition = {
  name: 'customers.get_company',
  displayName: 'Get company',
  description:
    'Fetch a company customer record by id with profile fields and (optionally) notes, activities, deals, people, addresses, tasks, tags, and custom fields. Returns { found: false } when outside tenant/org scope.',
  inputSchema: getCompanyInput,
  requiredFeatures: ['customers.companies.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = getCompanyInput.parse(rawInput)
    const em = resolveEm(ctx)
    const where: Record<string, unknown> = {
      id: input.companyId,
      tenantId,
      kind: 'company',
      deletedAt: null,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const entity = await findOneWithDecryption<CustomerEntity>(
      em,
      CustomerEntity,
      where as any,
      { populate: ['companyProfile'] as any } as any,
      buildScope(ctx, tenantId),
    )
    if (!entity || entity.tenantId !== tenantId) {
      return { found: false as const, companyId: input.companyId }
    }
    const profile = (entity as any).companyProfile as CustomerCompanyProfile | null | undefined
    const customFieldValues = await loadCustomFieldValues({
      em,
      entityId: E.customers.customer_entity,
      recordIds: [entity.id],
      tenantIdByRecord: { [entity.id]: entity.tenantId ?? null },
      organizationIdByRecord: { [entity.id]: entity.organizationId ?? null },
      tenantFallbacks: [entity.tenantId ?? tenantId].filter((value): value is string => !!value),
    })
    const customFields = customFieldValues[entity.id] ?? {}

    let related: Record<string, unknown> | null = null
    if (input.includeRelated) {
      const scope = buildScope(ctx, tenantId)
      const [addresses, activities, comments, todoLinks, interactions, tagAssignments, dealLinks, people] =
        await Promise.all([
          findWithDecryption<CustomerAddress>(
            em,
            CustomerAddress,
            { tenantId, entity: entity.id } as any,
            { limit: 100, orderBy: { isPrimary: 'desc', createdAt: 'desc' } as any } as any,
            scope,
          ),
          findWithDecryption<CustomerActivity>(
            em,
            CustomerActivity,
            { tenantId, entity: entity.id } as any,
            { limit: 100, orderBy: { occurredAt: 'desc', createdAt: 'desc' } as any } as any,
            scope,
          ),
          findWithDecryption<CustomerComment>(
            em,
            CustomerComment,
            { tenantId, entity: entity.id } as any,
            { limit: 100, orderBy: { createdAt: 'desc' } as any } as any,
            scope,
          ),
          findWithDecryption<CustomerTodoLink>(
            em,
            CustomerTodoLink,
            { tenantId, entity: entity.id } as any,
            { limit: 100, orderBy: { createdAt: 'desc' } as any } as any,
            scope,
          ),
          findWithDecryption<CustomerInteraction>(
            em,
            CustomerInteraction,
            { tenantId, entity: entity.id, deletedAt: null } as any,
            { limit: 100, orderBy: { scheduledAt: 'desc', createdAt: 'desc' } as any } as any,
            scope,
          ),
          findWithDecryption<CustomerTagAssignment>(
            em,
            CustomerTagAssignment,
            { tenantId, entity: entity.id } as any,
            { populate: ['tag'] as any } as any,
            scope,
          ),
          findWithDecryption<CustomerDealCompanyLink>(
            em,
            CustomerDealCompanyLink,
            { company: entity.id } as any,
            { populate: ['deal'] as any } as any,
            scope,
          ),
          findWithDecryption<CustomerPersonProfile>(
            em,
            CustomerPersonProfile,
            { tenantId, company: entity.id } as any,
            { limit: 100, populate: ['entity'] as any } as any,
            scope,
          ),
        ])
      related = {
        addresses: addresses.map((address) => ({
          id: address.id,
          name: address.name ?? null,
          purpose: address.purpose ?? null,
          addressLine1: address.addressLine1 ?? null,
          addressLine2: address.addressLine2 ?? null,
          city: address.city ?? null,
          region: address.region ?? null,
          postalCode: address.postalCode ?? null,
          country: address.country ?? null,
          isPrimary: !!address.isPrimary,
        })),
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
        tasks: todoLinks.map((link) => ({
          id: link.id,
          todoId: link.todoId,
          todoSource: link.todoSource,
          createdAt: link.createdAt ? new Date(link.createdAt).toISOString() : null,
        })),
        interactions: interactions.map((interaction) => ({
          id: interaction.id,
          interactionType: interaction.interactionType,
          title: interaction.title ?? null,
          status: interaction.status,
          scheduledAt: interaction.scheduledAt ? new Date(interaction.scheduledAt).toISOString() : null,
          occurredAt: interaction.occurredAt ? new Date(interaction.occurredAt).toISOString() : null,
        })),
        tags: tagAssignments
          .map((assignment) => {
            const tag = (assignment as any).tag as CustomerTag | string | null
            if (!tag || typeof tag === 'string') return null
            return { id: tag.id, slug: tag.slug, label: tag.label, color: tag.color ?? null }
          })
          .filter((entry): entry is { id: string; slug: string; label: string; color: string | null } => entry !== null),
        deals: dealLinks
          .map((link) => {
            const deal = (link as any).deal
            if (!deal || typeof deal === 'string') return null
            return {
              id: deal.id,
              title: deal.title,
              status: deal.status ?? null,
              pipelineStageId: deal.pipelineStageId ?? null,
              valueAmount: deal.valueAmount ?? null,
              valueCurrency: deal.valueCurrency ?? null,
            }
          })
          .filter((value): value is { id: string; title: string; status: string | null; pipelineStageId: string | null; valueAmount: string | null; valueCurrency: string | null } => value !== null),
        people: people
          .map((profileRow) => {
            const entityRef = (profileRow as any).entity as CustomerEntity | null
            if (!entityRef || entityRef.deletedAt) return null
            return {
              id: entityRef.id,
              displayName: entityRef.displayName,
              primaryEmail: entityRef.primaryEmail ?? null,
              primaryPhone: entityRef.primaryPhone ?? null,
              jobTitle: profileRow.jobTitle ?? null,
              department: profileRow.department ?? null,
            }
          })
          .filter((value): value is { id: string; displayName: string; primaryEmail: string | null; primaryPhone: string | null; jobTitle: string | null; department: string | null } => value !== null),
      }
    }
    return {
      found: true as const,
      company: {
        id: entity.id,
        displayName: entity.displayName,
        description: entity.description ?? null,
        primaryEmail: entity.primaryEmail ?? null,
        primaryPhone: entity.primaryPhone ?? null,
        status: entity.status ?? null,
        lifecycleStage: entity.lifecycleStage ?? null,
        source: entity.source ?? null,
        ownerUserId: entity.ownerUserId ?? null,
        organizationId: entity.organizationId ?? null,
        tenantId: entity.tenantId ?? null,
        createdAt: entity.createdAt ? new Date(entity.createdAt).toISOString() : null,
        updatedAt: entity.updatedAt ? new Date(entity.updatedAt).toISOString() : null,
      },
      profile: profile
        ? {
            id: profile.id,
            legalName: profile.legalName ?? null,
            brandName: profile.brandName ?? null,
            domain: profile.domain ?? null,
            websiteUrl: profile.websiteUrl ?? null,
            industry: profile.industry ?? null,
            sizeBucket: profile.sizeBucket ?? null,
            annualRevenue: profile.annualRevenue ?? null,
          }
        : null,
      customFields,
      related,
    }
  },
}

export const companiesAiTools: CustomersAiToolDefinition[] = [listCompaniesTool, getCompanyTool]

export default companiesAiTools
