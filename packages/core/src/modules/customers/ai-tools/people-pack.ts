/**
 * `customers.list_people` + `customers.get_person` (Phase 1 WS-C, Step 3.9).
 *
 * Read-only tools scoped to `ctx.tenantId` / `ctx.organizationId` that wrap
 * the existing customers query engine + encryption helpers. Mutation tools
 * are deferred to Step 5.13+ under the pending-action contract.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '#generated/entities.ids.generated'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  CustomerEntity,
  CustomerPersonProfile,
  CustomerAddress,
  CustomerActivity,
  CustomerComment,
  CustomerTodoLink,
  CustomerInteraction,
  CustomerDealPersonLink,
  CustomerTagAssignment,
  CustomerTag,
} from '../data/entities'
import { assertTenantScope, type CustomersAiToolDefinition, type CustomersToolContext } from './types'

function resolveEm(ctx: CustomersToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CustomersToolContext, tenantId: string) {
  return {
    tenantId,
    organizationId: ctx.organizationId,
  }
}

const listPeopleInput = z
  .object({
    q: z.string().trim().min(1).optional().describe('Optional search text matched against display name / email / phone.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum rows to return (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Number of rows to skip (default 0).'),
    tags: z.array(z.string().uuid()).optional().describe('Restrict to persons carrying at least one of these tag ids.'),
    companyId: z.string().uuid().optional().describe('Restrict to persons linked to the given company entity.'),
  })
  .passthrough()

const listPeopleTool: CustomersAiToolDefinition = {
  name: 'customers.list_people',
  displayName: 'List people',
  description:
    'Search / list people (CRM persons) for the caller tenant + organization. Returns { items, total, limit, offset }.',
  inputSchema: listPeopleInput,
  requiredFeatures: ['customers.people.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listPeopleInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = {
      tenantId,
      kind: 'person',
      deletedAt: null,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    if (input.q) {
      const pattern = `%${escapeLikePattern(input.q)}%`
      where.$or = [
        { displayName: { $ilike: pattern } },
        { primaryEmail: { $ilike: pattern } },
        { primaryPhone: { $ilike: pattern } },
        { description: { $ilike: pattern } },
      ]
    }
    if (input.companyId) {
      const profiles = await findWithDecryption<CustomerPersonProfile>(
        em,
        CustomerPersonProfile,
        { tenantId, company: input.companyId } as any,
        undefined,
        buildScope(ctx, tenantId),
      )
      const ids = profiles
        .map((profile) => {
          const entity = (profile as any).entity
          if (!entity) return null
          return typeof entity === 'string' ? entity : entity.id ?? null
        })
        .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
      if (!ids.length) {
        return { items: [], total: 0, limit, offset }
      }
      where.id = { $in: ids }
    }
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
      where.id = where.id ? { $in: (where.id as any).$in.filter((id: string) => scopedIds.includes(id)) } : { $in: scopedIds }
      if (Array.isArray((where.id as any).$in) && (where.id as any).$in.length === 0) {
        return { items: [], total: 0, limit, offset }
      }
    }
    const [rows, total] = await Promise.all([
      findWithDecryption<CustomerEntity>(
        em,
        CustomerEntity,
        where as any,
        { limit, offset, orderBy: { createdAt: 'desc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CustomerEntity, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        displayName: row.displayName,
        primaryEmail: row.primaryEmail ?? null,
        primaryPhone: row.primaryPhone ?? null,
        status: row.status ?? null,
        lifecycleStage: row.lifecycleStage ?? null,
        source: row.source ?? null,
        ownerUserId: row.ownerUserId ?? null,
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

const getPersonInput = z.object({
  personId: z.string().uuid().describe('Person entity id (UUID).'),
  includeRelated: z
    .boolean()
    .optional()
    .describe('When true, include notes, activities, deals, addresses, tasks, and tags (each capped at 100).'),
})

const getPersonTool: CustomersAiToolDefinition = {
  name: 'customers.get_person',
  displayName: 'Get person',
  description:
    'Fetch a person customer record by id with profile fields and (optionally) notes, activities, deals, addresses, tasks, tags, and custom fields. Returns { found: false } when the record is outside tenant/org scope or missing.',
  inputSchema: getPersonInput,
  requiredFeatures: ['customers.people.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = getPersonInput.parse(rawInput)
    const em = resolveEm(ctx)
    const where: Record<string, unknown> = {
      id: input.personId,
      tenantId,
      kind: 'person',
      deletedAt: null,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const entity = await findOneWithDecryption<CustomerEntity>(
      em,
      CustomerEntity,
      where as any,
      { populate: ['personProfile', 'personProfile.company'] as any } as any,
      buildScope(ctx, tenantId),
    )
    if (!entity || entity.tenantId !== tenantId) {
      return { found: false as const, personId: input.personId }
    }
    const profile = (entity as any).personProfile as CustomerPersonProfile | null | undefined
    const company = profile && (profile as any).company && typeof (profile as any).company === 'object'
      ? ((profile as any).company as CustomerEntity)
      : null
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
      const [addresses, activities, comments, todoLinks, interactions, tagAssignments, dealLinks] = await Promise.all([
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
        findWithDecryption<CustomerDealPersonLink>(
          em,
          CustomerDealPersonLink,
          { person: entity.id } as any,
          { populate: ['deal'] as any } as any,
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
      }
    }
    return {
      found: true as const,
      person: {
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
            firstName: profile.firstName ?? null,
            lastName: profile.lastName ?? null,
            preferredName: profile.preferredName ?? null,
            jobTitle: profile.jobTitle ?? null,
            department: profile.department ?? null,
            seniority: profile.seniority ?? null,
            timezone: profile.timezone ?? null,
            linkedInUrl: profile.linkedInUrl ?? null,
            twitterUrl: profile.twitterUrl ?? null,
            companyEntityId: company?.id ?? null,
          }
        : null,
      customFields,
      related,
    }
  },
}

export const peopleAiTools: CustomersAiToolDefinition[] = [listPeopleTool, getPersonTool]

export default peopleAiTools
