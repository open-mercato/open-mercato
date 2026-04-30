/**
 * `customers.list_activities` + `customers.list_tasks` (Phase 1 WS-C, Step 3.9)
 * plus the deal comment / activity manage tools (Phase 3 WS-C, follow-up).
 *
 * The mutation tools route every write through the AI pending-action approval
 * gate via `createAiApiOperationRunner` — same contract as
 * `customers.update_deal_stage`.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import {
  createAiApiOperationRunner,
  type AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerActivity,
  CustomerComment,
  CustomerDeal,
  CustomerDealCompanyLink,
  CustomerDealPersonLink,
  CustomerInteraction,
  CustomerTodoLink,
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

function recordVersionFromUpdatedAt(updatedAt: Date | null | undefined): string | null {
  if (!updatedAt) return null
  const value = updatedAt instanceof Date ? updatedAt : new Date(updatedAt)
  if (Number.isNaN(value.getTime())) return null
  return value.toISOString()
}

// LLMs frequently emit `""` for "not provided" — coerce blanks (and surrounding
// whitespace) to `undefined` BEFORE per-field validators run. Mirrors the
// `blankToUndefined` helper in deals-pack.ts.
const blankToUndefined = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

async function loadDealForScope(
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

/**
 * `CustomerDeal` does NOT carry a direct `entity` field — deals are linked
 * to people / companies via the `customer_deal_person_links` and
 * `customer_deal_company_links` tables. Comments however need a non-null
 * `entity_id` (the timeline owner) so this helper resolves the deal's
 * first linked person, then falls back to its first linked company. When
 * neither exists, the caller MUST instruct the operator to link a contact
 * before commenting on the deal.
 */
async function resolveDealCommentEntityId(
  em: EntityManager,
  ctx: CustomersToolContext,
  tenantId: string,
  dealId: string,
): Promise<string | null> {
  const personLink = await em.findOne(
    CustomerDealPersonLink,
    { deal: dealId, tenantId } as never,
    { populate: ['personEntity'] as never },
  )
  if (personLink) {
    const linked = (personLink as unknown as { personEntity?: { id?: string | null } | null }).personEntity
    if (linked && typeof linked === 'object' && typeof linked.id === 'string') return linked.id
    const raw = (personLink as unknown as { personEntity?: unknown }).personEntity
    if (typeof raw === 'string') return raw
  }
  const companyLink = await em.findOne(
    CustomerDealCompanyLink,
    { deal: dealId, tenantId } as never,
    { populate: ['companyEntity'] as never },
  )
  if (companyLink) {
    const linked = (companyLink as unknown as { companyEntity?: { id?: string | null } | null }).companyEntity
    if (linked && typeof linked === 'object' && typeof linked.id === 'string') return linked.id
    const raw = (companyLink as unknown as { companyEntity?: unknown }).companyEntity
    if (typeof raw === 'string') return raw
  }
  return null
}

async function loadCommentForScope(
  em: EntityManager,
  ctx: CustomersToolContext,
  tenantId: string,
  commentId: string,
): Promise<CustomerComment | null> {
  const where: Record<string, unknown> = { id: commentId, tenantId }
  if (ctx.organizationId) where.organizationId = ctx.organizationId
  const row = await findOneWithDecryption<CustomerComment>(
    em,
    CustomerComment,
    where as any,
    undefined,
    buildScope(ctx, tenantId),
  )
  if (!row || row.tenantId !== tenantId) return null
  if (ctx.organizationId && row.organizationId !== ctx.organizationId) return null
  return row
}

async function loadActivityForScope(
  em: EntityManager,
  ctx: CustomersToolContext,
  tenantId: string,
  activityId: string,
): Promise<CustomerActivity | null> {
  const where: Record<string, unknown> = { id: activityId, tenantId }
  if (ctx.organizationId) where.organizationId = ctx.organizationId
  const row = await findOneWithDecryption<CustomerActivity>(
    em,
    CustomerActivity,
    where as any,
    undefined,
    buildScope(ctx, tenantId),
  )
  if (!row || row.tenantId !== tenantId) return null
  if (ctx.organizationId && row.organizationId !== ctx.organizationId) return null
  return row
}

function commentEntityIdOf(row: CustomerComment): string | null {
  const ent = (row as any).entity
  if (!ent) return null
  if (typeof ent === 'string') return ent
  if (typeof ent === 'object' && typeof ent.id === 'string') return ent.id
  return null
}

function activityEntityIdOf(row: CustomerActivity): string | null {
  const ent = (row as any).entity
  if (!ent) return null
  if (typeof ent === 'string') return ent
  if (typeof ent === 'object' && typeof ent.id === 'string') return ent.id
  return null
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
        entityId: activityEntityIdOf(row),
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

// ---------------------------------------------------------------------------
// customers.list_deal_comments — read-only dedicated comment listing
// ---------------------------------------------------------------------------

const listDealCommentsInput = z
  .object({
    dealId: z.string().uuid().describe('Deal id whose comments should be listed.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const listDealCommentsTool: CustomersAiToolDefinition = {
  name: 'customers.list_deal_comments',
  displayName: 'List deal comments',
  description:
    'List comments left on a specific deal, ordered by most recent first. Read-only; tenant + organization scoped.',
  inputSchema: listDealCommentsInput,
  requiredFeatures: ['customers.activities.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listDealCommentsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = { tenantId, deal: input.dealId }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const [rows, total] = await Promise.all([
      findWithDecryption<CustomerComment>(
        em,
        CustomerComment,
        where as any,
        { limit, offset, orderBy: { createdAt: 'desc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CustomerComment, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        body: row.body ?? null,
        entityId: commentEntityIdOf(row),
        dealId: (row as any).deal && typeof (row as any).deal === 'object' ? (row as any).deal.id : (row as any).deal ?? null,
        authorUserId: row.authorUserId ?? null,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      })),
      total,
      limit,
      offset,
    }
  },
}

// ---------------------------------------------------------------------------
// customers.manage_deal_comment — create / update / delete a deal comment
// ---------------------------------------------------------------------------

const manageDealCommentInput = z
  .object({
    operation: z
      .enum(['create', 'update', 'delete'])
      .describe('Which write to perform: create a new comment, update an existing one, or delete it.'),
    dealId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Required for `create` — the deal the comment is attached to.'),
    commentId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Required for `update` and `delete` — id of the existing comment row.'),
    body: z
      .preprocess(blankToUndefined, z.string().min(1).max(8000).optional())
      .describe('Comment text. Required for `create`; optional on `update`.'),
  })
  .superRefine((value, ctx) => {
    if (value.operation === 'create') {
      if (!value.dealId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'dealId is required for create.', path: ['dealId'] })
      if (!value.body) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'body is required for create.', path: ['body'] })
    }
    if (value.operation === 'update') {
      if (!value.commentId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'commentId is required for update.', path: ['commentId'] })
      if (!value.body) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'body is required for update.', path: ['body'] })
    }
    if (value.operation === 'delete') {
      if (!value.commentId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'commentId is required for delete.', path: ['commentId'] })
    }
  })

type ManageDealCommentInput = z.infer<typeof manageDealCommentInput>

const manageDealCommentTool: CustomersAiToolDefinition = {
  name: 'customers.manage_deal_comment',
  displayName: 'Manage deal comment',
  description:
    'Create, update, or delete a comment on a deal. Mutation tool — every call routes through the AI pending-action approval gate. Use `operation` to pick the action.',
  inputSchema: manageDealCommentInput as z.ZodType<unknown>,
  requiredFeatures: ['customers.activities.manage'],
  tags: ['write', 'customers'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx): Promise<CustomersToolLoadBeforeSingleRecord | null> => {
    const { tenantId } = assertTenantScope(ctx)
    const input: ManageDealCommentInput = manageDealCommentInput.parse(rawInput)
    const em = resolveEm(ctx)
    if (input.operation === 'create') {
      const deal = await loadDealForScope(em, ctx, tenantId, input.dealId!)
      if (!deal) return null
      return {
        recordId: deal.id,
        entityType: 'customers.deal',
        recordVersion: recordVersionFromUpdatedAt(deal.updatedAt),
        before: { commentId: null, body: null, dealId: deal.id },
      }
    }
    const existing = await loadCommentForScope(em, ctx, tenantId, input.commentId!)
    if (!existing) return null
    return {
      recordId: existing.id,
      entityType: 'customers.customer_comment',
      recordVersion: recordVersionFromUpdatedAt(existing.updatedAt),
      before: {
        body: existing.body ?? null,
        dealId: (existing as any).deal && typeof (existing as any).deal === 'object'
          ? (existing as any).deal.id
          : (existing as any).deal ?? null,
        entityId: commentEntityIdOf(existing),
        authorUserId: existing.authorUserId ?? null,
      },
    }
  },
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input: ManageDealCommentInput = manageDealCommentInput.parse(rawInput)
    const em = resolveEm(ctx)
    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)

    if (input.operation === 'create') {
      const deal = await loadDealForScope(em, ctx, tenantId, input.dealId!)
      if (!deal) throw new Error(`Deal "${input.dealId}" is not accessible to the caller.`)
      const organizationId = deal.organizationId
      if (!organizationId) throw new Error(`Deal "${deal.id}" has no organization scope.`)
      // `CustomerDeal` has no direct `.entity` field — deals link to
      // people/companies via two link tables. Resolve the first available
      // person, then fall back to the first linked company. Only fail the
      // operation when the deal has no linked contacts at all.
      const dealEntityId = await resolveDealCommentEntityId(em, ctx, tenantId, deal.id)
      if (!dealEntityId) {
        throw new Error(
          `Deal "${deal.id}" has no linked person or company. Link a contact to the deal in the backoffice before adding a comment, or post the comment directly on the person/company record instead.`,
        )
      }
      const body: Record<string, unknown> = {
        tenantId,
        organizationId,
        dealId: deal.id,
        // Comments require an `entityId` (the person/company on the timeline).
        entityId: dealEntityId,
        body: input.body,
      }
      const response = await runner.run({ method: 'POST', path: '/customers/comments', body })
      if (!response.success) {
        throw new Error(response.error ?? 'Failed to create comment')
      }
      const result = (response.data ?? {}) as { id?: string | null }
      return {
        operation: 'create' as const,
        commentId: result.id ?? null,
        dealId: deal.id,
        commandName: 'customers.comments.create',
        before: null,
        after: { body: input.body ?? null, dealId: deal.id },
      }
    }

    if (input.operation === 'update') {
      const existing = await loadCommentForScope(em, ctx, tenantId, input.commentId!)
      if (!existing) throw new Error(`Comment "${input.commentId}" is not accessible to the caller.`)
      const organizationId = existing.organizationId
      if (!organizationId) throw new Error(`Comment "${existing.id}" has no organization scope.`)
      const body: Record<string, unknown> = {
        id: existing.id,
        tenantId,
        organizationId,
        body: input.body,
      }
      const response = await runner.run({ method: 'PUT', path: '/customers/comments', body })
      if (!response.success) {
        throw new Error(response.error ?? `Failed to update comment "${existing.id}"`)
      }
      const after = await loadCommentForScope(em, ctx, tenantId, existing.id)
      return {
        operation: 'update' as const,
        commentId: existing.id,
        commandName: 'customers.comments.update',
        before: { body: existing.body ?? null },
        after: after ? { body: after.body ?? null } : null,
      }
    }

    // delete
    const existing = await loadCommentForScope(em, ctx, tenantId, input.commentId!)
    if (!existing) throw new Error(`Comment "${input.commentId}" is not accessible to the caller.`)
    const body: Record<string, unknown> = { id: existing.id }
    const response = await runner.run({ method: 'DELETE', path: '/customers/comments', body })
    if (!response.success) {
      throw new Error(response.error ?? `Failed to delete comment "${existing.id}"`)
    }
    return {
      operation: 'delete' as const,
      commentId: existing.id,
      commandName: 'customers.comments.delete',
      before: { body: existing.body ?? null },
      after: null,
    }
  },
}

// ---------------------------------------------------------------------------
// customers.manage_deal_activity — create / update / delete an activity
// ---------------------------------------------------------------------------

const manageDealActivityInput = z
  .object({
    operation: z
      .enum(['create', 'update', 'delete'])
      .describe('Which write to perform: create a new activity, update an existing one, or delete it.'),
    activityId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Required for `update` and `delete`.'),
    dealId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Required for `create` — the deal the activity is logged against.'),
    activityType: z
      .preprocess(blankToUndefined, z.string().min(1).max(100).optional())
      .describe('Required for `create` — e.g. "call", "email", "meeting", "note".'),
    subject: z
      .preprocess(blankToUndefined, z.string().max(200).optional())
      .describe('Optional short subject line.'),
    body: z
      .preprocess(blankToUndefined, z.string().max(8000).optional())
      .describe('Optional free-text body.'),
    occurredAt: z
      .preprocess(blankToUndefined, z.string().datetime().optional())
      .describe('ISO-8601 timestamp when the activity occurred. Omit for "now" (server-side default applies).'),
  })
  .superRefine((value, ctx) => {
    if (value.operation === 'create') {
      if (!value.dealId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'dealId is required for create.', path: ['dealId'] })
      if (!value.activityType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'activityType is required for create.', path: ['activityType'] })
    }
    if (value.operation === 'update' || value.operation === 'delete') {
      if (!value.activityId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'activityId is required.', path: ['activityId'] })
    }
  })

type ManageDealActivityInput = z.infer<typeof manageDealActivityInput>

const manageDealActivityTool: CustomersAiToolDefinition = {
  name: 'customers.manage_deal_activity',
  displayName: 'Manage deal activity',
  description:
    'Create, update, or delete a deal activity (call, email, meeting, note, etc.). Mutation tool — every call routes through the AI pending-action approval gate. Use `operation` to pick the action.',
  inputSchema: manageDealActivityInput as z.ZodType<unknown>,
  requiredFeatures: ['customers.activities.manage'],
  tags: ['write', 'customers'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx): Promise<CustomersToolLoadBeforeSingleRecord | null> => {
    const { tenantId } = assertTenantScope(ctx)
    const input: ManageDealActivityInput = manageDealActivityInput.parse(rawInput)
    const em = resolveEm(ctx)
    if (input.operation === 'create') {
      const deal = await loadDealForScope(em, ctx, tenantId, input.dealId!)
      if (!deal) return null
      return {
        recordId: deal.id,
        entityType: 'customers.deal',
        recordVersion: recordVersionFromUpdatedAt(deal.updatedAt),
        before: { activityId: null, dealId: deal.id },
      }
    }
    const existing = await loadActivityForScope(em, ctx, tenantId, input.activityId!)
    if (!existing) return null
    return {
      recordId: existing.id,
      entityType: 'customers.customer_activity',
      recordVersion: recordVersionFromUpdatedAt(existing.updatedAt),
      before: {
        activityType: existing.activityType,
        subject: existing.subject ?? null,
        body: existing.body ?? null,
        occurredAt: existing.occurredAt ? new Date(existing.occurredAt).toISOString() : null,
        dealId: (existing as any).deal && typeof (existing as any).deal === 'object'
          ? (existing as any).deal.id
          : (existing as any).deal ?? null,
      },
    }
  },
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input: ManageDealActivityInput = manageDealActivityInput.parse(rawInput)
    const em = resolveEm(ctx)
    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)

    if (input.operation === 'create') {
      const deal = await loadDealForScope(em, ctx, tenantId, input.dealId!)
      if (!deal) throw new Error(`Deal "${input.dealId}" is not accessible to the caller.`)
      const organizationId = deal.organizationId
      if (!organizationId) throw new Error(`Deal "${deal.id}" has no organization scope.`)
      const dealEntity = (deal as unknown as { entity?: unknown }).entity
      const entityId =
        dealEntity && typeof dealEntity === 'object'
          ? (dealEntity as { id?: string | null }).id ?? null
          : typeof dealEntity === 'string'
            ? dealEntity
            : null
      if (!entityId) {
        throw new Error(`Deal "${deal.id}" has no associated person/company; cannot attach an activity.`)
      }
      const body: Record<string, unknown> = {
        tenantId,
        organizationId,
        entityId,
        dealId: deal.id,
        activityType: input.activityType,
      }
      if (input.subject) body.subject = input.subject
      if (input.body) body.body = input.body
      if (input.occurredAt) body.occurredAt = input.occurredAt
      const response = await runner.run({ method: 'POST', path: '/customers/activities', body })
      if (!response.success) {
        throw new Error(response.error ?? 'Failed to create activity')
      }
      const result = (response.data ?? {}) as { id?: string | null }
      return {
        operation: 'create' as const,
        activityId: result.id ?? null,
        dealId: deal.id,
        commandName: 'customers.activities.create',
        before: null,
        after: {
          activityType: input.activityType ?? null,
          subject: input.subject ?? null,
          body: input.body ?? null,
          occurredAt: input.occurredAt ?? null,
        },
      }
    }

    if (input.operation === 'update') {
      const existing = await loadActivityForScope(em, ctx, tenantId, input.activityId!)
      if (!existing) throw new Error(`Activity "${input.activityId}" is not accessible to the caller.`)
      const organizationId = existing.organizationId
      if (!organizationId) throw new Error(`Activity "${existing.id}" has no organization scope.`)
      const body: Record<string, unknown> = { id: existing.id, tenantId, organizationId }
      if (input.activityType) body.activityType = input.activityType
      if (input.subject !== undefined) body.subject = input.subject
      if (input.body !== undefined) body.body = input.body
      if (input.occurredAt !== undefined) body.occurredAt = input.occurredAt
      const response = await runner.run({ method: 'PUT', path: '/customers/activities', body })
      if (!response.success) {
        throw new Error(response.error ?? `Failed to update activity "${existing.id}"`)
      }
      const after = await loadActivityForScope(em, ctx, tenantId, existing.id)
      return {
        operation: 'update' as const,
        activityId: existing.id,
        commandName: 'customers.activities.update',
        before: {
          activityType: existing.activityType,
          subject: existing.subject ?? null,
          body: existing.body ?? null,
          occurredAt: existing.occurredAt ? new Date(existing.occurredAt).toISOString() : null,
        },
        after: after
          ? {
              activityType: after.activityType,
              subject: after.subject ?? null,
              body: after.body ?? null,
              occurredAt: after.occurredAt ? new Date(after.occurredAt).toISOString() : null,
            }
          : null,
      }
    }

    // delete
    const existing = await loadActivityForScope(em, ctx, tenantId, input.activityId!)
    if (!existing) throw new Error(`Activity "${input.activityId}" is not accessible to the caller.`)
    const body: Record<string, unknown> = { id: existing.id }
    const response = await runner.run({ method: 'DELETE', path: '/customers/activities', body })
    if (!response.success) {
      throw new Error(response.error ?? `Failed to delete activity "${existing.id}"`)
    }
    return {
      operation: 'delete' as const,
      activityId: existing.id,
      commandName: 'customers.activities.delete',
      before: {
        activityType: existing.activityType,
        subject: existing.subject ?? null,
        body: existing.body ?? null,
      },
      after: null,
    }
  },
}

// ---------------------------------------------------------------------------
// customers.list_record_comments — list comments on a person / company / deal
// ---------------------------------------------------------------------------

const listRecordCommentsInput = z
  .object({
    personId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Restrict to comments on this person entity id.'),
    companyId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Restrict to comments on this company entity id.'),
    dealId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Restrict to comments attached to this deal id.'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .superRefine((value, ctx) => {
    if (!value.personId && !value.companyId && !value.dealId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one of personId, companyId, or dealId.',
        path: ['personId'],
      })
    }
  })

const listRecordCommentsTool: CustomersAiToolDefinition = {
  name: 'customers.list_record_comments',
  displayName: 'List record comments',
  description:
    'List comments left on a person, company, or deal record. Read-only; tenant + organization scoped. Provide at least one of `personId`, `companyId`, or `dealId`.',
  inputSchema: listRecordCommentsInput as z.ZodType<unknown>,
  requiredFeatures: ['customers.activities.view'],
  tags: ['read', 'customers'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listRecordCommentsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = { tenantId }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const entityId = input.personId ?? input.companyId ?? null
    if (entityId) where.entity = entityId
    if (input.dealId) where.deal = input.dealId
    const [rows, total] = await Promise.all([
      findWithDecryption<CustomerComment>(
        em,
        CustomerComment,
        where as any,
        { limit, offset, orderBy: { createdAt: 'desc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(CustomerComment, where as any),
    ])
    const filtered = rows.filter((row) => row.tenantId === tenantId)
    return {
      items: filtered.map((row) => ({
        id: row.id,
        body: row.body ?? null,
        entityId: commentEntityIdOf(row),
        dealId: (row as any).deal && typeof (row as any).deal === 'object' ? (row as any).deal.id : (row as any).deal ?? null,
        authorUserId: row.authorUserId ?? null,
        organizationId: row.organizationId ?? null,
        tenantId: row.tenantId ?? null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      })),
      total,
      limit,
      offset,
    }
  },
}

// ---------------------------------------------------------------------------
// customers.manage_record_comment — create / update / delete a comment on a
// person, company, or deal record. Mutation tool.
// ---------------------------------------------------------------------------

const manageRecordCommentInput = z
  .object({
    operation: z
      .enum(['create', 'update', 'delete'])
      .describe('Which write to perform: create a new comment, update an existing one, or delete it.'),
    personId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Required for `create` (or supply `companyId`) — the person entity the comment is attached to.'),
    companyId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Required for `create` (or supply `personId`) — the company entity the comment is attached to.'),
    dealId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Optional on `create` — when set, the comment also shows up under that deal.'),
    commentId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Required for `update` and `delete` — id of the existing comment row.'),
    body: z
      .preprocess(blankToUndefined, z.string().min(1).max(8000).optional())
      .describe('Comment text. Required for `create`; optional on `update`.'),
  })
  .superRefine((value, ctx) => {
    if (value.operation === 'create') {
      if (!value.personId && !value.companyId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide personId or companyId for create.',
          path: ['personId'],
        })
      }
      if (value.personId && value.companyId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide only one of personId or companyId.',
          path: ['personId'],
        })
      }
      if (!value.body) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'body is required for create.', path: ['body'] })
    }
    if (value.operation === 'update') {
      if (!value.commentId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'commentId is required for update.', path: ['commentId'] })
      if (!value.body) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'body is required for update.', path: ['body'] })
    }
    if (value.operation === 'delete') {
      if (!value.commentId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'commentId is required for delete.', path: ['commentId'] })
    }
  })

type ManageRecordCommentInput = z.infer<typeof manageRecordCommentInput>

const manageRecordCommentTool: CustomersAiToolDefinition = {
  name: 'customers.manage_record_comment',
  displayName: 'Manage record comment',
  description:
    'Create, update, or delete a comment on a person, company, or deal record. Mutation tool — every call routes through the AI pending-action approval gate. Use `operation` to pick the action; for `create` provide `personId` OR `companyId` (and optionally `dealId`).',
  inputSchema: manageRecordCommentInput as z.ZodType<unknown>,
  requiredFeatures: ['customers.activities.manage'],
  tags: ['write', 'customers'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx): Promise<CustomersToolLoadBeforeSingleRecord | null> => {
    const { tenantId } = assertTenantScope(ctx)
    const input: ManageRecordCommentInput = manageRecordCommentInput.parse(rawInput)
    const em = resolveEm(ctx)
    if (input.operation === 'create') {
      const entityId = input.personId ?? input.companyId
      // We do not load the host person/company entity here — the
      // `customers/comments` POST handler validates its existence and tenant
      // scope. We do hydrate the deal when supplied so the approval card has
      // a stable record-version anchor.
      if (input.dealId) {
        const deal = await loadDealForScope(em, ctx, tenantId, input.dealId)
        if (!deal) return null
        return {
          recordId: deal.id,
          entityType: 'customers.deal',
          recordVersion: recordVersionFromUpdatedAt(deal.updatedAt),
          before: { commentId: null, body: null, entityId, dealId: deal.id },
        }
      }
      return {
        recordId: entityId!,
        entityType: input.personId ? 'customers.person' : 'customers.company',
        recordVersion: null,
        before: { commentId: null, body: null, entityId, dealId: null },
      }
    }
    const existing = await loadCommentForScope(em, ctx, tenantId, input.commentId!)
    if (!existing) return null
    return {
      recordId: existing.id,
      entityType: 'customers.customer_comment',
      recordVersion: recordVersionFromUpdatedAt(existing.updatedAt),
      before: {
        body: existing.body ?? null,
        dealId: (existing as any).deal && typeof (existing as any).deal === 'object'
          ? (existing as any).deal.id
          : (existing as any).deal ?? null,
        entityId: commentEntityIdOf(existing),
        authorUserId: existing.authorUserId ?? null,
      },
    }
  },
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input: ManageRecordCommentInput = manageRecordCommentInput.parse(rawInput)
    const em = resolveEm(ctx)
    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)

    if (input.operation === 'create') {
      const entityId = input.personId ?? input.companyId!
      // Resolve organization scope: prefer the deal's org when one is supplied,
      // otherwise fall back to the caller context's org.
      let organizationId: string | null = ctx.organizationId
      let dealId: string | null = null
      if (input.dealId) {
        const deal = await loadDealForScope(em, ctx, tenantId, input.dealId)
        if (!deal) throw new Error(`Deal "${input.dealId}" is not accessible to the caller.`)
        organizationId = deal.organizationId ?? organizationId
        dealId = deal.id
      }
      if (!organizationId) {
        throw new Error('Organization scope is required to create a comment.')
      }
      const body: Record<string, unknown> = {
        tenantId,
        organizationId,
        entityId,
        body: input.body,
      }
      if (dealId) body.dealId = dealId
      const response = await runner.run({ method: 'POST', path: '/customers/comments', body })
      if (!response.success) {
        throw new Error(response.error ?? 'Failed to create comment')
      }
      const result = (response.data ?? {}) as { id?: string | null }
      return {
        operation: 'create' as const,
        commentId: result.id ?? null,
        entityId,
        dealId,
        commandName: 'customers.comments.create',
        before: null,
        after: { body: input.body ?? null, entityId, dealId },
      }
    }

    if (input.operation === 'update') {
      const existing = await loadCommentForScope(em, ctx, tenantId, input.commentId!)
      if (!existing) throw new Error(`Comment "${input.commentId}" is not accessible to the caller.`)
      const organizationId = existing.organizationId
      if (!organizationId) throw new Error(`Comment "${existing.id}" has no organization scope.`)
      const body: Record<string, unknown> = {
        id: existing.id,
        tenantId,
        organizationId,
        body: input.body,
      }
      const response = await runner.run({ method: 'PUT', path: '/customers/comments', body })
      if (!response.success) {
        throw new Error(response.error ?? `Failed to update comment "${existing.id}"`)
      }
      const after = await loadCommentForScope(em, ctx, tenantId, existing.id)
      return {
        operation: 'update' as const,
        commentId: existing.id,
        commandName: 'customers.comments.update',
        before: { body: existing.body ?? null },
        after: after ? { body: after.body ?? null } : null,
      }
    }

    // delete
    const existing = await loadCommentForScope(em, ctx, tenantId, input.commentId!)
    if (!existing) throw new Error(`Comment "${input.commentId}" is not accessible to the caller.`)
    const body: Record<string, unknown> = { id: existing.id }
    const response = await runner.run({ method: 'DELETE', path: '/customers/comments', body })
    if (!response.success) {
      throw new Error(response.error ?? `Failed to delete comment "${existing.id}"`)
    }
    return {
      operation: 'delete' as const,
      commentId: existing.id,
      commandName: 'customers.comments.delete',
      before: { body: existing.body ?? null },
      after: null,
    }
  },
}

// ---------------------------------------------------------------------------
// customers.manage_record_activity — create / update / delete an activity on
// a person, company, or deal record. Mutation tool.
// ---------------------------------------------------------------------------

const manageRecordActivityInput = z
  .object({
    operation: z
      .enum(['create', 'update', 'delete'])
      .describe('Which write to perform: create a new activity, update an existing one, or delete it.'),
    activityId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Required for `update` and `delete`.'),
    personId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Required for `create` (or supply `companyId`) — the person entity the activity is logged on.'),
    companyId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Required for `create` (or supply `personId`) — the company entity the activity is logged on.'),
    dealId: z
      .preprocess(blankToUndefined, z.string().uuid().optional())
      .describe('Optional on `create` — when set, the activity is also linked to that deal.'),
    activityType: z
      .preprocess(blankToUndefined, z.string().min(1).max(100).optional())
      .describe('Required for `create` — e.g. "call", "email", "meeting", "note".'),
    subject: z
      .preprocess(blankToUndefined, z.string().max(200).optional())
      .describe('Optional short subject line.'),
    body: z
      .preprocess(blankToUndefined, z.string().max(8000).optional())
      .describe('Optional free-text body.'),
    occurredAt: z
      .preprocess(blankToUndefined, z.string().datetime().optional())
      .describe('ISO-8601 timestamp when the activity occurred. Omit for "now" (server-side default applies).'),
  })
  .superRefine((value, ctx) => {
    if (value.operation === 'create') {
      if (!value.personId && !value.companyId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide personId or companyId for create.',
          path: ['personId'],
        })
      }
      if (value.personId && value.companyId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide only one of personId or companyId.',
          path: ['personId'],
        })
      }
      if (!value.activityType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'activityType is required for create.', path: ['activityType'] })
    }
    if (value.operation === 'update' || value.operation === 'delete') {
      if (!value.activityId) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'activityId is required.', path: ['activityId'] })
    }
  })

type ManageRecordActivityInput = z.infer<typeof manageRecordActivityInput>

const manageRecordActivityTool: CustomersAiToolDefinition = {
  name: 'customers.manage_record_activity',
  displayName: 'Manage record activity',
  description:
    'Create, update, or delete an activity (call, email, meeting, note) on a person, company, or deal record. Mutation tool — every call routes through the AI pending-action approval gate. For `create` provide `personId` OR `companyId` (and optionally `dealId`).',
  inputSchema: manageRecordActivityInput as z.ZodType<unknown>,
  requiredFeatures: ['customers.activities.manage'],
  tags: ['write', 'customers'],
  isMutation: true,
  loadBeforeRecord: async (rawInput, ctx): Promise<CustomersToolLoadBeforeSingleRecord | null> => {
    const { tenantId } = assertTenantScope(ctx)
    const input: ManageRecordActivityInput = manageRecordActivityInput.parse(rawInput)
    const em = resolveEm(ctx)
    if (input.operation === 'create') {
      const entityId = input.personId ?? input.companyId
      if (input.dealId) {
        const deal = await loadDealForScope(em, ctx, tenantId, input.dealId)
        if (!deal) return null
        return {
          recordId: deal.id,
          entityType: 'customers.deal',
          recordVersion: recordVersionFromUpdatedAt(deal.updatedAt),
          before: { activityId: null, dealId: deal.id, entityId },
        }
      }
      return {
        recordId: entityId!,
        entityType: input.personId ? 'customers.person' : 'customers.company',
        recordVersion: null,
        before: { activityId: null, entityId, dealId: null },
      }
    }
    const existing = await loadActivityForScope(em, ctx, tenantId, input.activityId!)
    if (!existing) return null
    return {
      recordId: existing.id,
      entityType: 'customers.customer_activity',
      recordVersion: recordVersionFromUpdatedAt(existing.updatedAt),
      before: {
        activityType: existing.activityType,
        subject: existing.subject ?? null,
        body: existing.body ?? null,
        occurredAt: existing.occurredAt ? new Date(existing.occurredAt).toISOString() : null,
        entityId: activityEntityIdOf(existing),
        dealId: (existing as any).deal && typeof (existing as any).deal === 'object'
          ? (existing as any).deal.id
          : (existing as any).deal ?? null,
      },
    }
  },
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input: ManageRecordActivityInput = manageRecordActivityInput.parse(rawInput)
    const em = resolveEm(ctx)
    const runner = createAiApiOperationRunner(ctx as unknown as AiToolExecutionContext)

    if (input.operation === 'create') {
      const entityId = input.personId ?? input.companyId!
      let organizationId: string | null = ctx.organizationId
      let dealId: string | null = null
      if (input.dealId) {
        const deal = await loadDealForScope(em, ctx, tenantId, input.dealId)
        if (!deal) throw new Error(`Deal "${input.dealId}" is not accessible to the caller.`)
        organizationId = deal.organizationId ?? organizationId
        dealId = deal.id
      }
      if (!organizationId) {
        throw new Error('Organization scope is required to create an activity.')
      }
      const body: Record<string, unknown> = {
        tenantId,
        organizationId,
        entityId,
        activityType: input.activityType,
      }
      if (dealId) body.dealId = dealId
      if (input.subject) body.subject = input.subject
      if (input.body) body.body = input.body
      if (input.occurredAt) body.occurredAt = input.occurredAt
      const response = await runner.run({ method: 'POST', path: '/customers/activities', body })
      if (!response.success) {
        throw new Error(response.error ?? 'Failed to create activity')
      }
      const result = (response.data ?? {}) as { id?: string | null }
      return {
        operation: 'create' as const,
        activityId: result.id ?? null,
        entityId,
        dealId,
        commandName: 'customers.activities.create',
        before: null,
        after: {
          activityType: input.activityType ?? null,
          subject: input.subject ?? null,
          body: input.body ?? null,
          occurredAt: input.occurredAt ?? null,
        },
      }
    }

    if (input.operation === 'update') {
      const existing = await loadActivityForScope(em, ctx, tenantId, input.activityId!)
      if (!existing) throw new Error(`Activity "${input.activityId}" is not accessible to the caller.`)
      const organizationId = existing.organizationId
      if (!organizationId) throw new Error(`Activity "${existing.id}" has no organization scope.`)
      const body: Record<string, unknown> = { id: existing.id, tenantId, organizationId }
      if (input.activityType) body.activityType = input.activityType
      if (input.subject !== undefined) body.subject = input.subject
      if (input.body !== undefined) body.body = input.body
      if (input.occurredAt !== undefined) body.occurredAt = input.occurredAt
      const response = await runner.run({ method: 'PUT', path: '/customers/activities', body })
      if (!response.success) {
        throw new Error(response.error ?? `Failed to update activity "${existing.id}"`)
      }
      const after = await loadActivityForScope(em, ctx, tenantId, existing.id)
      return {
        operation: 'update' as const,
        activityId: existing.id,
        commandName: 'customers.activities.update',
        before: {
          activityType: existing.activityType,
          subject: existing.subject ?? null,
          body: existing.body ?? null,
          occurredAt: existing.occurredAt ? new Date(existing.occurredAt).toISOString() : null,
        },
        after: after
          ? {
              activityType: after.activityType,
              subject: after.subject ?? null,
              body: after.body ?? null,
              occurredAt: after.occurredAt ? new Date(after.occurredAt).toISOString() : null,
            }
          : null,
      }
    }

    // delete
    const existing = await loadActivityForScope(em, ctx, tenantId, input.activityId!)
    if (!existing) throw new Error(`Activity "${input.activityId}" is not accessible to the caller.`)
    const body: Record<string, unknown> = { id: existing.id }
    const response = await runner.run({ method: 'DELETE', path: '/customers/activities', body })
    if (!response.success) {
      throw new Error(response.error ?? `Failed to delete activity "${existing.id}"`)
    }
    return {
      operation: 'delete' as const,
      activityId: existing.id,
      commandName: 'customers.activities.delete',
      before: {
        activityType: existing.activityType,
        subject: existing.subject ?? null,
        body: existing.body ?? null,
      },
      after: null,
    }
  },
}

export const activitiesTasksAiTools: CustomersAiToolDefinition[] = [
  listActivitiesTool,
  listTasksTool,
  listDealCommentsTool,
  manageDealCommentTool,
  manageDealActivityTool,
  listRecordCommentsTool,
  manageRecordCommentTool,
  manageRecordActivityTool,
]

export default activitiesTasksAiTools
