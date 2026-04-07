import { commandRegistry, registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandLogMetadata, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { CustomerTodoLink } from '../data/entities'
import { z } from 'zod'
import {
  todoLinkWithTodoCreateSchema,
  type TodoLinkWithTodoCreateInput,
  type InteractionCreateInput,
} from '../data/validators'
import {
  extractUndoPayload,
  ensureOrganizationScope,
  ensureTenantScope,
  resolveParentResourceKind,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  CUSTOMER_INTERACTION_TASK_SOURCE,
  CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
} from '../lib/interactionCompatibility'
import { resolveLegacyTodoDetails } from '../lib/todoCompatibility'

type InteractionSnapshot = {
  interaction: {
    id: string
    organizationId: string
    tenantId: string
    entityId: string
    entityKind: string | null
    dealId: string | null
    interactionType: string
    title: string | null
    body: string | null
    status: string
    scheduledAt: Date | null
    occurredAt: Date | null
    priority: number | null
    authorUserId: string | null
    ownerUserId: string | null
    appearanceIcon: string | null
    appearanceColor: string | null
    source: string | null
  }
  custom?: Record<string, unknown>
}

type InteractionUndoPayload = {
  before?: InteractionSnapshot | null
  after?: InteractionSnapshot | null
}

type LegacyTodoDetail = {
  title: string | null
  isDone: boolean | null
  priority: number | null
  severity: string | null
  description: string | null
  dueAt: string | null
  organizationId: string | null
  customValues: Record<string, unknown> | null
}

type TodoTargetResolution = {
  interactionId: string
  before: InteractionSnapshot | null
  legacyLink: CustomerTodoLink | null
  detail: LegacyTodoDetail | null
  canonicalExists: boolean
}

const unlinkSchema = z.object({
  linkId: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

function getRequiredHandler<TInput, TResult>(id: string): CommandHandler<TInput, TResult> {
  const handler = commandRegistry.get(id) as CommandHandler<TInput, TResult> | null
  if (!handler) {
    throw new Error(`Missing command handler: ${id}`)
  }
  return handler
}

function collectTodoCustomValues(input: TodoLinkWithTodoCreateInput): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  if (input.todoCustom && typeof input.todoCustom === 'object') {
    Object.assign(values, input.todoCustom)
  }
  if (input.custom && typeof input.custom === 'object') {
    Object.assign(values, input.custom)
  }
  return values
}

function resolveTodoScheduledAt(customValues: Record<string, unknown>): string | null {
  const dueAt = customValues.due_at
  if (typeof dueAt === 'string' && dueAt.trim().length > 0) return dueAt
  const camelCaseDueAt = customValues.dueAt
  if (typeof camelCaseDueAt === 'string' && camelCaseDueAt.trim().length > 0) return camelCaseDueAt
  return null
}

function parseTodoScheduledAt(value: string | null): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function resolveTodoPriority(customValues: Record<string, unknown>): number | null {
  const raw = customValues.priority
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

function resolveTodoDescription(customValues: Record<string, unknown>): string | null {
  const raw = customValues.description
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null
}

function mapTodoCreateInput(
  input: TodoLinkWithTodoCreateInput,
): InteractionCreateInput & { customValues?: Record<string, unknown> } {
  const customValues = collectTodoCustomValues(input)
  return {
    entityId: input.entityId,
    interactionType: 'task',
    title: input.title,
    status: input.is_done === true || input.isDone === true ? 'done' : 'planned',
    authorUserId: input.createdByUserId ?? null,
    priority: resolveTodoPriority(customValues),
    body: resolveTodoDescription(customValues),
    scheduledAt: parseTodoScheduledAt(resolveTodoScheduledAt(customValues)),
    source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
    ...(Object.keys(customValues).length > 0 ? { customValues } : {}),
  }
}

function normalizeUndoCreateLogEntry(
  logEntry: unknown,
  payload: InteractionUndoPayload | null | undefined,
): CommandLogMetadata | Record<string, unknown> {
  const base = logEntry && typeof logEntry === 'object' ? { ...(logEntry as Record<string, unknown>) } : {}
  const resourceId =
    typeof base.resourceId === 'string' && base.resourceId.trim().length > 0
      ? base.resourceId
      : payload?.after?.interaction.id ?? null
  return resourceId ? { ...base, resourceId } : base
}

async function loadInteractionSnapshot(
  interactionId: string,
  ctx: CommandRuntimeContext,
): Promise<InteractionSnapshot | null> {
  const canonicalDelete = getRequiredHandler<
    { body?: Record<string, unknown>; query?: Record<string, unknown> },
    { interactionId: string }
  >('customers.interactions.delete')
  const prepared = await canonicalDelete.prepare?.({ body: { id: interactionId } }, ctx)
  if (!prepared || typeof prepared !== 'object' || !('before' in prepared)) return null
  return (prepared.before as InteractionSnapshot | undefined) ?? null
}

async function loadLegacyTodoDetail(
  ctx: CommandRuntimeContext,
  link: CustomerTodoLink,
): Promise<LegacyTodoDetail | null> {
  let queryEngine: QueryEngine | null = null
  try {
    queryEngine = ctx.container.resolve('queryEngine') as QueryEngine
  } catch {
    queryEngine = null
  }
  if (!queryEngine) return null

  const details = await resolveLegacyTodoDetails(
    queryEngine,
    [link],
    link.tenantId,
    [link.organizationId],
  )
  const source =
    typeof link.todoSource === 'string' && link.todoSource.trim().length > 0
      ? link.todoSource
      : 'example:todo'
  return details.get(`${source}:${link.todoId}`) ?? null
}

function buildSyntheticTodoSnapshot(
  link: CustomerTodoLink,
  detail: LegacyTodoDetail | null,
): InteractionSnapshot {
  const entityRef = link.entity
  const entityId = typeof entityRef === 'string' ? entityRef : entityRef.id
  const entityKind =
    typeof entityRef === 'object' && entityRef !== null && 'kind' in entityRef
      ? (entityRef as { kind: string | null }).kind ?? null
      : null
  const customValues = { ...(detail?.customValues ?? {}) }
  if (detail?.priority !== null && detail?.priority !== undefined && customValues.priority === undefined) {
    customValues.priority = detail.priority
  }
  if (detail?.description && customValues.description === undefined) {
    customValues.description = detail.description
  }
  if (detail?.dueAt && customValues.due_at === undefined && customValues.dueAt === undefined) {
    customValues.due_at = detail.dueAt
  }
  return {
    interaction: {
      id: link.todoId,
      organizationId: link.organizationId,
      tenantId: link.tenantId,
      entityId,
      entityKind,
      dealId: null,
      interactionType: 'task',
      title: detail?.title ?? null,
      body: detail?.description ?? null,
      status: detail?.isDone ? 'done' : 'planned',
      scheduledAt: detail?.dueAt ? new Date(detail.dueAt) : null,
      occurredAt: null,
      priority: detail?.priority ?? null,
      authorUserId: link.createdByUserId ?? null,
      ownerUserId: null,
      appearanceIcon: null,
      appearanceColor: null,
      source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
    },
    custom: Object.keys(customValues).length > 0 ? customValues : undefined,
  }
}

function mapLegacyLinkToInteractionCreateInput(
  link: CustomerTodoLink,
  detail: LegacyTodoDetail | null,
): InteractionCreateInput & { customValues?: Record<string, unknown> } {
  const entityRef = link.entity
  const entityId = typeof entityRef === 'string' ? entityRef : entityRef.id
  const customValues = { ...(detail?.customValues ?? {}) }
  if (detail?.priority !== null && detail?.priority !== undefined && customValues.priority === undefined) {
    customValues.priority = detail.priority
  }
  if (detail?.description && customValues.description === undefined) {
    customValues.description = detail.description
  }
  if (detail?.dueAt && customValues.due_at === undefined && customValues.dueAt === undefined) {
    customValues.due_at = detail.dueAt
  }
  return {
    id: link.todoId,
    entityId,
    interactionType: 'task',
    title: detail?.title ?? null,
    body: detail?.description ?? null,
    status: detail?.isDone ? 'done' : 'planned',
    scheduledAt: parseTodoScheduledAt(detail?.dueAt ?? null),
    priority: detail?.priority ?? null,
    authorUserId: link.createdByUserId ?? null,
    source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
    ...(Object.keys(customValues).length > 0 ? { customValues } : {}),
  }
}

async function resolveTodoTarget(
  linkId: string,
  ctx: CommandRuntimeContext,
): Promise<TodoTargetResolution> {
  const directSnapshot = await loadInteractionSnapshot(linkId, ctx)
  if (directSnapshot) {
    return {
      interactionId: linkId,
      before: directSnapshot,
      legacyLink: null,
      detail: null,
      canonicalExists: true,
    }
  }

  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const legacyLink = await em.findOne(CustomerTodoLink, { id: linkId }, { populate: ['entity'] })
  if (!legacyLink) {
    throw new CrudHttpError(404, { error: 'Todo link not found' })
  }

  const bridgedSnapshot = await loadInteractionSnapshot(legacyLink.todoId, ctx)
  if (bridgedSnapshot) {
    return {
      interactionId: legacyLink.todoId,
      before: bridgedSnapshot,
      legacyLink,
      detail: null,
      canonicalExists: true,
    }
  }

  const detail = await loadLegacyTodoDetail(ctx, legacyLink)
  return {
    interactionId: legacyLink.todoId,
    before: buildSyntheticTodoSnapshot(legacyLink, detail),
    legacyLink,
    detail,
    canonicalExists: false,
  }
}

/** @deprecated Use interaction commands instead. Maintained as a compatibility bridge per SPEC-046b. */
const unlinkTodoCommand: CommandHandler<
  z.infer<typeof unlinkSchema>,
  { linkId: string; interactionId: string }
> = {
  id: 'customers.todos.unlink',
  async prepare(rawInput, ctx) {
    const parsed = unlinkSchema.parse(rawInput)
    const target = await resolveTodoTarget(parsed.linkId, ctx)
    return target.before ? { before: target.before } : {}
  },
  async execute(rawInput, ctx) {
    const parsed = unlinkSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const target = await resolveTodoTarget(parsed.linkId, ctx)
    if (!target.canonicalExists) {
      if (!target.legacyLink) {
        throw new CrudHttpError(404, { error: 'Todo link not found' })
      }
      const canonicalCreate = getRequiredHandler<
        InteractionCreateInput & { customValues?: Record<string, unknown> },
        { interactionId: string }
      >('customers.interactions.create')
      await canonicalCreate.execute(
        mapLegacyLinkToInteractionCreateInput(target.legacyLink, target.detail),
        ctx,
      )
    }

    const canonicalDelete = getRequiredHandler<
      { body?: Record<string, unknown>; query?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.delete')
    await canonicalDelete.execute({ body: { id: target.interactionId } }, ctx)

    return { linkId: parsed.linkId, interactionId: target.interactionId }
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as InteractionSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.todos.unlink', 'Unlink todo'),
      resourceKind: 'customers.todoLink',
      resourceId: result.linkId,
      parentResourceKind: resolveParentResourceKind(before?.interaction.entityKind),
      parentResourceId: before?.interaction.entityId ?? null,
      tenantId: before?.interaction.tenantId ?? null,
      organizationId: before?.interaction.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: {
        undo: {
          before: before ?? null,
        } satisfies InteractionUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const canonicalDelete = getRequiredHandler<
      { body?: Record<string, unknown>; query?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.delete')
    if (!canonicalDelete.undo) return
    await canonicalDelete.undo({
      input: {},
      ctx,
      logEntry,
    })
  },
}

/** @deprecated Use interaction commands instead. Maintained as a compatibility bridge per SPEC-046b. */
const createTodoCommand: CommandHandler<TodoLinkWithTodoCreateInput, { linkId: string; todoId: string }> = {
  id: 'customers.todos.create',
  async execute(rawInput, ctx) {
    const parsed = todoLinkWithTodoCreateSchema.parse(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const canonicalCreate = getRequiredHandler<
      InteractionCreateInput & { customValues?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.create')
    const result = await canonicalCreate.execute(mapTodoCreateInput(parsed), ctx)
    return { linkId: result.interactionId, todoId: result.interactionId }
  },
  captureAfter: async (_input, result, ctx) => {
    const canonicalCreate = getRequiredHandler<
      InteractionCreateInput & { customValues?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.create')
    if (!canonicalCreate.captureAfter) return null
    return canonicalCreate.captureAfter(
      {
        entityId: '00000000-0000-0000-0000-000000000000',
        interactionType: 'task',
        status: 'planned',
      },
      { interactionId: result.todoId },
      ctx,
    )
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const snapshot = snapshots.after as InteractionSnapshot | undefined
    return {
      actionLabel: translate('customers.audit.todos.create', 'Create todo'),
      resourceKind: 'customers.todoLink',
      resourceId: result.linkId,
      parentResourceKind: resolveParentResourceKind(snapshot?.interaction.entityKind),
      parentResourceId: snapshot?.interaction.entityId ?? null,
      tenantId: snapshot?.interaction.tenantId ?? null,
      organizationId: snapshot?.interaction.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          after: snapshot ?? null,
        } satisfies InteractionUndoPayload,
      },
      context: {
        todoSource: CUSTOMER_INTERACTION_TASK_SOURCE,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<InteractionUndoPayload>(logEntry)
    const canonicalCreate = getRequiredHandler<
      InteractionCreateInput & { customValues?: Record<string, unknown> },
      { interactionId: string }
    >('customers.interactions.create')
    if (!canonicalCreate.undo) return
    await canonicalCreate.undo({
      input: {
        entityId: payload?.after?.interaction.entityId ?? '00000000-0000-0000-0000-000000000000',
        interactionType: 'task',
        status: 'planned',
      },
      ctx,
      logEntry: normalizeUndoCreateLogEntry(logEntry, payload),
    })
  },
}

registerCommand(unlinkTodoCommand)
registerCommand(createTodoCommand)
