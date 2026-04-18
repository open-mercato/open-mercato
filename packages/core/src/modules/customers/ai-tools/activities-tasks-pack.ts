/**
 * `customers.list_activities` + `customers.list_tasks` (Phase 1 WS-C, Step 3.9).
 *
 * Read-only listings scoped by entity/deal. Task creation / completion is
 * deferred to Step 5.13+ (pending-action gate).
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerActivity, CustomerInteraction, CustomerTodoLink } from '../data/entities'
import { assertTenantScope, type CustomersAiToolDefinition, type CustomersToolContext } from './types'

function resolveEm(ctx: CustomersToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CustomersToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const listActivitiesInput = z
  .object({
    personId: z.string().uuid().optional().describe('Restrict to activities attached to this person entity id.'),
    companyId: z.string().uuid().optional().describe('Restrict to activities attached to this company entity id.'),
    dealId: z.string().uuid().optional().describe('Restrict to activities attached to this deal id.'),
    activityType: z.string().optional().describe('Filter by activity type (e.g. "call", "email").'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const listActivitiesTool: CustomersAiToolDefinition = {
  name: 'customers.list_activities',
  displayName: 'List activities',
  description:
    'List logged customer activities (calls, emails, meetings, notes, etc.) scoped to tenant + organization. Supply `personId` / `companyId` / `dealId` to narrow; otherwise returns the most recent activities across the tenant.',
  inputSchema: listActivitiesInput,
  requiredFeatures: ['customers.activities.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listActivitiesInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = { tenantId }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const entityId = input.personId ?? input.companyId ?? null
    if (entityId) where.entity = entityId
    if (input.dealId) where.deal = input.dealId
    if (input.activityType) where.activityType = input.activityType
    const [rows, total] = await Promise.all([
      findWithDecryption<CustomerActivity>(
        em,
        CustomerActivity,
        where as any,
        { limit, offset, orderBy: { occurredAt: 'desc', createdAt: 'desc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CustomerActivity, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        activityType: row.activityType,
        subject: row.subject ?? null,
        body: row.body ?? null,
        occurredAt: row.occurredAt ? new Date(row.occurredAt).toISOString() : null,
        authorUserId: row.authorUserId ?? null,
        entityId: (row as any).entity && typeof (row as any).entity === 'object' ? (row as any).entity.id : (row as any).entity ?? null,
        dealId: (row as any).deal && typeof (row as any).deal === 'object' ? (row as any).deal.id : (row as any).deal ?? null,
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

const listTasksInput = z
  .object({
    personId: z.string().uuid().optional().describe('Restrict to tasks linked to this person entity id.'),
    companyId: z.string().uuid().optional().describe('Restrict to tasks linked to this company entity id.'),
    dealId: z.string().uuid().optional().describe('Restrict to tasks connected to this deal id.'),
    status: z
      .enum(['open', 'done', 'cancelled'])
      .optional()
      .describe('Filter canonical interaction tasks by status. Ignored when listing legacy todo links.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const listTasksTool: CustomersAiToolDefinition = {
  name: 'customers.list_tasks',
  displayName: 'List tasks',
  description:
    'List customer tasks scoped to tenant + organization. Returns canonical interaction tasks (interactionType="task") merged with legacy todo links for compatibility.',
  inputSchema: listTasksInput,
  requiredFeatures: ['customers.activities.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listTasksInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const entityId = input.personId ?? input.companyId ?? null
    const interactionWhere: Record<string, unknown> = {
      tenantId,
      interactionType: 'task',
      deletedAt: null,
    }
    if (ctx.organizationId) interactionWhere.organizationId = ctx.organizationId
    if (entityId) interactionWhere.entity = entityId
    if (input.dealId) interactionWhere.dealId = input.dealId
    if (input.status) interactionWhere.status = input.status === 'open' ? 'planned' : input.status === 'done' ? 'completed' : 'cancelled'
    const interactionRows = await findWithDecryption<CustomerInteraction>(
      em,
      CustomerInteraction,
      interactionWhere as any,
      { limit, offset, orderBy: { scheduledAt: 'desc', createdAt: 'desc' } as any } as any,
      buildScope(ctx, tenantId),
    )
    const legacyWhere: Record<string, unknown> = { tenantId }
    if (ctx.organizationId) legacyWhere.organizationId = ctx.organizationId
    if (entityId) legacyWhere.entity = entityId
    const legacyRows =
      input.status || input.dealId
        ? []
        : await findWithDecryption<CustomerTodoLink>(
            em,
            CustomerTodoLink,
            legacyWhere as any,
            { limit, offset, orderBy: { createdAt: 'desc' } as any } as any,
            buildScope(ctx, tenantId),
          )
    const filteredInteractions = interactionRows.filter((row) => row.tenantId === tenantId)
    const filteredLegacy = legacyRows.filter((row) => row.tenantId === tenantId)
    const items = [
      ...filteredInteractions.map((row) => ({
        kind: 'interaction' as const,
        id: row.id,
        title: row.title ?? null,
        body: row.body ?? null,
        status: row.status,
        scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : null,
        occurredAt: row.occurredAt ? new Date(row.occurredAt).toISOString() : null,
        dealId: row.dealId ?? null,
        ownerUserId: row.ownerUserId ?? null,
        priority: row.priority ?? null,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      })),
      ...filteredLegacy.map((row) => ({
        kind: 'todo_link' as const,
        id: row.id,
        todoId: row.todoId,
        todoSource: row.todoSource,
        entityId: (row as any).entity && typeof (row as any).entity === 'object' ? (row as any).entity.id : (row as any).entity ?? null,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      })),
    ]
    return {
      items,
      total: items.length,
      limit,
      offset,
    }
  },
}

export const activitiesTasksAiTools: CustomersAiToolDefinition[] = [listActivitiesTool, listTasksTool]

export default activitiesTasksAiTools
