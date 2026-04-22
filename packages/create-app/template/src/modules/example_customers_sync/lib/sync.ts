import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerInteraction,
  CustomerTodoLink,
} from '@open-mercato/core/modules/customers/data/entities'
import {
  CUSTOMER_INTERACTION_TASK_TYPE,
  CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
  type InteractionRecord,
} from '@open-mercato/core/modules/customers/lib/interactionCompatibility'
import { hydrateCanonicalInteractions } from '@open-mercato/core/modules/customers/lib/interactionReadModel'
const EXAMPLE_TODO_ENTITY_ID = 'example:todo' as const
import { Todo } from '../../example/data/entities'
import { ExampleCustomerInteractionMapping } from '../data/entities'
import { emitExampleCustomersSyncEvent } from '../events'
import {
  buildExampleTodoCustomValuesFromInteraction,
  buildInteractionUpdateFromExampleTodo,
  deleteExampleCustomerInteractionMapping,
  findMappingByInteractionId,
  findMappingByTodoId,
  upsertExampleCustomerInteractionMapping,
} from './mappings'
import {
  buildExampleCustomersSyncCommandContext,
  EXAMPLE_CUSTOMERS_SYNC_INBOUND_ORIGIN,
  EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_ORIGIN,
  type ExampleCustomersSyncScope,
} from './runtime'
import { resolveExampleCustomersSyncFlags } from './toggles'

type ContainerLike = {
  resolve: <T = unknown>(name: string) => T
}

export type ExampleCustomersSyncOutboundJobPayload = ExampleCustomersSyncScope & {
  eventId: string
  interactionId: string
}

export type ExampleCustomersSyncInboundJobPayload = ExampleCustomersSyncScope & {
  eventId: string
  todoId: string
}

export type ExampleCustomersSyncReconcileJobPayload = ExampleCustomersSyncScope & {
  limit?: number
  cursor?: string
}

type ExampleTodoSnapshot = {
  id: string
  title: string
  isDone: boolean
  updatedAt: Date | null
  customValues: Record<string, unknown> | null
}

type LegacyExampleTodoLinkRow = {
  id: string
  entityId: string
  todoId: string
  createdByUserId: string | null
  createdAt: Date
}

export type ExampleCustomersSyncReconcileItem = {
  linkId: string
  todoId: string
  interactionId: string | null
  status: 'mapped' | 'created_interaction' | 'skipped' | 'failed'
  message?: string | null
}

export type ExampleCustomersSyncReconcileResult = {
  items: ExampleCustomersSyncReconcileItem[]
  nextCursor?: string
  processed: number
  mapped: number
  createdInteractions: number
  failed: number
}

type CursorPayload = {
  createdAt: string
  id: string
}

const DEFAULT_TASK_TITLE = 'Untitled task'

function isSyncOriginFromBridge(syncOrigin: unknown): boolean {
  return typeof syncOrigin === 'string' && syncOrigin.startsWith('example_customers_sync:')
}

function isTaskEventPayload(payload: { interactionType?: string | null }): boolean {
  return payload.interactionType === CUSTOMER_INTERACTION_TASK_TYPE
}

function parseDateOrNull(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function trimErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? 'Unknown sync error')
  return message.length > 2000 ? `${message.slice(0, 1997)}...` : message
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof CrudHttpError) return error.status === 404
  if (error instanceof Error) return /not found/i.test(error.message)
  return false
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (
      (typeof (error as { code?: unknown }).code === 'string' && (error as { code: string }).code === '23505')
      || (typeof (error as { message?: unknown }).message === 'string'
        && (error as { message: string }).message.toLowerCase().includes('duplicate key'))
    )
  )
}

async function emitMappingEvent(
  eventId: 'example_customers_sync.mapping.created' | 'example_customers_sync.mapping.updated' | 'example_customers_sync.mapping.deleted',
  mapping: Pick<
    ExampleCustomerInteractionMapping,
    'id' | 'interactionId' | 'todoId' | 'organizationId' | 'tenantId' | 'syncStatus' | 'lastSyncedAt' | 'lastError' | 'sourceUpdatedAt'
  >,
): Promise<void> {
  await emitExampleCustomersSyncEvent(
    eventId,
    {
      id: mapping.id,
      interactionId: mapping.interactionId,
      todoId: mapping.todoId,
      organizationId: mapping.organizationId,
      tenantId: mapping.tenantId,
      syncStatus: mapping.syncStatus,
      lastSyncedAt: mapping.lastSyncedAt?.toISOString() ?? null,
      lastError: mapping.lastError ?? null,
      sourceUpdatedAt: mapping.sourceUpdatedAt?.toISOString() ?? null,
    },
    { persistent: true },
  ).catch(() => undefined)
}

async function emitSyncFailedEvent(payload: {
  scope: ExampleCustomersSyncScope
  interactionId?: string | null
  todoId?: string | null
  error: string
  direction: 'outbound' | 'inbound'
  eventId: string
}): Promise<void> {
  await emitExampleCustomersSyncEvent(
    'example_customers_sync.sync.failed',
    {
      interactionId: payload.interactionId ?? null,
      todoId: payload.todoId ?? null,
      organizationId: payload.scope.organizationId,
      tenantId: payload.scope.tenantId,
      error: payload.error,
      direction: payload.direction,
      eventId: payload.eventId,
    },
    { persistent: true },
  ).catch(() => undefined)
}

async function updateMappingAfterSync(
  em: EntityManager,
  input: ExampleCustomersSyncScope & {
    interactionId: string
    todoId: string
    sourceUpdatedAt?: Date | null
  },
): Promise<ExampleCustomerInteractionMapping> {
  const { mapping, created } = await upsertExampleCustomerInteractionMapping(em, {
    ...input,
    syncStatus: 'synced',
    lastSyncedAt: new Date(),
    lastError: null,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
  })
  await emitMappingEvent(created ? 'example_customers_sync.mapping.created' : 'example_customers_sync.mapping.updated', mapping)
  return mapping
}

async function markMappingError(
  em: EntityManager,
  input: {
    scope: ExampleCustomersSyncScope
    interactionId: string
    todoId: string
    error: string
    mapping: ExampleCustomerInteractionMapping | null
    sourceUpdatedAt?: Date | null
  },
): Promise<ExampleCustomerInteractionMapping> {
  if (input.mapping) {
    input.mapping.syncStatus = 'error'
    input.mapping.lastError = input.error
    input.mapping.updatedAt = new Date()
    await em.flush()
    await emitMappingEvent('example_customers_sync.mapping.updated', input.mapping)
    return input.mapping
  }

  const { mapping, created } = await upsertExampleCustomerInteractionMapping(em, {
    ...input.scope,
    interactionId: input.interactionId,
    todoId: input.todoId,
    syncStatus: 'error',
    lastSyncedAt: null,
    lastError: input.error,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
  })
  await emitMappingEvent(created ? 'example_customers_sync.mapping.created' : 'example_customers_sync.mapping.updated', mapping)
  return mapping
}

export function resolveInboundInteractionSyncStrategy(input: {
  currentStatus?: string | null
  isDone: boolean
}): {
  updateStatusInCommand: boolean
  lifecycleCommandId: 'customers.interactions.complete' | null
} {
  if (input.isDone) {
    return {
      updateStatusInCommand: false,
      lifecycleCommandId: input.currentStatus === 'done' ? null : 'customers.interactions.complete',
    }
  }
  return {
    updateStatusInCommand: true,
    lifecycleCommandId: null,
  }
}

export function resolveMappingTodoIdForSyncFailure(input: {
  interactionId: string
  mappingTodoId?: string | null
}): string {
  return typeof input.mappingTodoId === 'string' && input.mappingTodoId.length > 0
    ? input.mappingTodoId
    : input.interactionId
}

async function loadCanonicalInteractionRecord(
  container: ContainerLike,
  scope: ExampleCustomersSyncScope,
  interactionId: string,
): Promise<InteractionRecord | null> {
  const em = (container.resolve('em') as EntityManager).fork()
  const interaction = await findOneWithDecryption(
    em,
    CustomerInteraction,
    {
      id: interactionId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!interaction) return null
  const [record] = await hydrateCanonicalInteractions({
    em,
    container,
    auth: {
      tenantId: scope.tenantId,
      orgId: scope.organizationId,
      sub: `system:${EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_ORIGIN}`,
    },
    selectedOrganizationId: scope.organizationId,
    interactions: [interaction],
    enrich: false,
  })
  return record ?? null
}

async function loadExampleTodoSnapshot(
  em: EntityManager,
  scope: ExampleCustomersSyncScope,
  todoId: string,
): Promise<ExampleTodoSnapshot | null> {
  const todo = await findOneWithDecryption(
    em,
    Todo,
    {
      id: todoId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!todo) return null
  const customValues = await loadCustomFieldSnapshot(em, {
    entityId: EXAMPLE_TODO_ENTITY_ID,
    recordId: todo.id,
    tenantId: todo.tenantId ?? null,
    organizationId: todo.organizationId ?? null,
  })
  return {
    id: todo.id,
    title: todo.title,
    isDone: todo.isDone,
    updatedAt: todo.updatedAt ?? null,
    customValues: Object.keys(customValues).length > 0 ? customValues : null,
  }
}

async function deleteMappedExampleTodo(params: {
  container: ContainerLike
  scope: ExampleCustomersSyncScope
  mapping: ExampleCustomerInteractionMapping
}): Promise<void> {
  const commandBus = params.container.resolve('commandBus') as CommandBus
  const commandContext = buildExampleCustomersSyncCommandContext(
    params.container,
    params.scope,
    EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_ORIGIN,
  )
  try {
    await commandBus.execute<{ id: string }, Todo>('example.todos.delete', {
      input: { id: params.mapping.todoId },
      ctx: commandContext,
    })
  } catch (error) {
    if (!isNotFoundError(error)) throw error
  }
  const em = (params.container.resolve('em') as EntityManager).fork()
  const existing = await findMappingByInteractionId(em, params.scope, params.mapping.interactionId)
  const deleted = await deleteExampleCustomerInteractionMapping(em, existing)
  if (deleted && existing) {
    await emitMappingEvent('example_customers_sync.mapping.deleted', existing)
  }
}

function resolveLegacyLinkEntityId(
  link: CustomerTodoLink,
): string | null {
  const entityRef = link.entity as { id?: string } | string | null | undefined
  if (typeof entityRef === 'string' && entityRef.trim().length > 0) return entityRef
  if (entityRef && typeof entityRef === 'object' && typeof entityRef.id === 'string' && entityRef.id.trim().length > 0) {
    return entityRef.id
  }
  return null
}

async function loadLegacyExampleTodoLinkRow(
  em: EntityManager,
  scope: ExampleCustomersSyncScope,
  todoId: string,
): Promise<LegacyExampleTodoLinkRow | null> {
  const link = await findOneWithDecryption(
    em,
    CustomerTodoLink,
    {
      todoId,
      todoSource: 'example:todo',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
  if (!link) return null
  const entityId = resolveLegacyLinkEntityId(link)
  if (!entityId) return null
  return {
    id: link.id,
    entityId,
    todoId: link.todoId,
    createdByUserId: link.createdByUserId ?? null,
    createdAt: link.createdAt,
  }
}

async function ensureLegacyExampleMapping(
  em: EntityManager,
  scope: ExampleCustomersSyncScope,
  interactionId: string,
): Promise<ExampleCustomerInteractionMapping | null> {
  const legacyLink = await findOneWithDecryption(
    em,
    CustomerTodoLink,
    {
      todoId: interactionId,
      todoSource: 'example:todo',
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    undefined,
    scope,
  )
  if (!legacyLink) return null
  return await updateMappingAfterSync(em, {
    ...scope,
    interactionId,
    todoId: legacyLink.todoId,
    sourceUpdatedAt: legacyLink.createdAt ?? null,
  })
}

export async function syncCustomerInteractionToExampleTodo(
  container: ContainerLike,
  payload: ExampleCustomersSyncOutboundJobPayload,
): Promise<void> {
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const flags = await resolveExampleCustomersSyncFlags(container, scope.tenantId)
  if (!flags.enabled) return

  const em = (container.resolve('em') as EntityManager).fork()
  let mapping = await findMappingByInteractionId(em, scope, payload.interactionId)

  try {
    const interaction = await loadCanonicalInteractionRecord(container, scope, payload.interactionId)

    if (!interaction) {
      if (mapping) {
        await deleteMappedExampleTodo({ container, scope, mapping })
      }
      return
    }
    if (interaction.interactionType !== CUSTOMER_INTERACTION_TASK_TYPE) return

    if (!mapping && interaction.source === CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE) {
      mapping = await ensureLegacyExampleMapping(em, scope, interaction.id)
    }

    if (interaction.status === 'canceled' || payload.eventId === 'customers.interaction.deleted') {
      if (mapping) {
        await deleteMappedExampleTodo({ container, scope, mapping })
      }
      return
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const commandContext = buildExampleCustomersSyncCommandContext(
      container,
      scope,
      EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_ORIGIN,
    )
    const title =
      typeof interaction.title === 'string' && interaction.title.trim().length > 0
        ? interaction.title.trim()
        : DEFAULT_TASK_TITLE
    const customValues = buildExampleTodoCustomValuesFromInteraction(interaction, {
      includeClears: !!mapping,
    })
    const sourceUpdatedAt = parseDateOrNull(interaction.updatedAt)

    if (mapping) {
      try {
        await commandBus.execute<Record<string, unknown>, Todo>('example.todos.update', {
          input: {
            id: mapping.todoId,
            title,
            is_done: interaction.status === 'done',
            ...(Object.keys(customValues).length > 0 ? { customValues } : {}),
          },
          ctx: commandContext,
        })
        await updateMappingAfterSync(em, {
          ...scope,
          interactionId: interaction.id,
          todoId: mapping.todoId,
          sourceUpdatedAt,
        })
        return
      } catch (error) {
        if (!isNotFoundError(error)) throw error
      }
    }

    try {
      const createResult = await commandBus.execute<Record<string, unknown>, Todo>('example.todos.create', {
        input: {
          id: interaction.id,
          title,
          is_done: interaction.status === 'done',
          ...(Object.keys(customValues).length > 0 ? { customValues } : {}),
        },
        ctx: commandContext,
      })

      await updateMappingAfterSync(em, {
        ...scope,
        interactionId: interaction.id,
        todoId: String(createResult.result.id),
        sourceUpdatedAt,
      })
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error
      const existingTodo = await loadExampleTodoSnapshot(em, scope, interaction.id)
      if (!existingTodo) throw error
      await commandBus.execute<Record<string, unknown>, Todo>('example.todos.update', {
        input: {
          id: existingTodo.id,
          title,
          is_done: interaction.status === 'done',
          ...(Object.keys(customValues).length > 0 ? { customValues } : {}),
        },
        ctx: commandContext,
      })
      await updateMappingAfterSync(em, {
        ...scope,
        interactionId: interaction.id,
        todoId: existingTodo.id,
        sourceUpdatedAt,
      })
    }
  } catch (error) {
    const message = trimErrorMessage(error)
    const erroredMapping = await markMappingError(em, {
      scope,
      interactionId: payload.interactionId,
      todoId: resolveMappingTodoIdForSyncFailure({
        interactionId: payload.interactionId,
        mappingTodoId: mapping?.todoId,
      }),
      error: message,
      mapping,
    })
    await emitSyncFailedEvent({
      scope,
      interactionId: payload.interactionId,
      todoId: erroredMapping.todoId,
      error: message,
      direction: 'outbound',
      eventId: payload.eventId,
    })
    throw error
  }
}

export async function syncExampleTodoToCanonicalInteraction(
  container: ContainerLike,
  payload: ExampleCustomersSyncInboundJobPayload,
): Promise<void> {
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }
  const flags = await resolveExampleCustomersSyncFlags(container, scope.tenantId)
  if (!flags.enabled || !flags.bidirectional) return

  const em = (container.resolve('em') as EntityManager).fork()
  let mapping = await findMappingByTodoId(em, scope, payload.todoId)
  let todo: ExampleTodoSnapshot | null = null
  if (!mapping && payload.eventId !== 'example.todo.deleted') {
    mapping = await ensureMappingForLegacyExampleTodo(container, scope, payload.todoId)
  }
  if (!mapping) return

  try {
    const commandBus = container.resolve('commandBus') as CommandBus
    const commandContext = buildExampleCustomersSyncCommandContext(
      container,
      scope,
      EXAMPLE_CUSTOMERS_SYNC_INBOUND_ORIGIN,
    )

    if (payload.eventId === 'example.todo.deleted') {
      try {
        await commandBus.execute<Record<string, unknown>, { interactionId: string }>('customers.interactions.delete', {
          input: { body: { id: mapping.interactionId } },
          ctx: commandContext,
        })
      } catch (error) {
        if (!isNotFoundError(error)) throw error
      }
      const deleted = await deleteExampleCustomerInteractionMapping(em, mapping)
      if (deleted) {
        await emitMappingEvent('example_customers_sync.mapping.deleted', mapping)
      }
      return
    }

    todo = await loadExampleTodoSnapshot(em, scope, mapping.todoId)
    if (!todo) {
      try {
        await commandBus.execute<Record<string, unknown>, { interactionId: string }>('customers.interactions.delete', {
          input: { body: { id: mapping.interactionId } },
          ctx: commandContext,
        })
      } catch (error) {
        if (!isNotFoundError(error)) throw error
      }
      const deleted = await deleteExampleCustomerInteractionMapping(em, mapping)
      if (deleted) {
        await emitMappingEvent('example_customers_sync.mapping.deleted', mapping)
      }
      return
    }

    const interaction = await findOneWithDecryption(
      em,
      CustomerInteraction,
      {
        id: mapping.interactionId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    if (!interaction) {
      const deleted = await deleteExampleCustomerInteractionMapping(em, mapping)
      if (deleted) {
        await emitMappingEvent('example_customers_sync.mapping.deleted', mapping)
      }
      return
    }

    const patch = buildInteractionUpdateFromExampleTodo({
      title: todo.title,
      isDone: todo.isDone,
      customValues: todo.customValues,
      occurredAt: todo.isDone ? (todo.updatedAt ?? new Date()) : null,
    }, {
      includeClears: true,
    })
    const strategy = resolveInboundInteractionSyncStrategy({
      currentStatus: interaction.status,
      isDone: todo.isDone,
    })
    const customValuesInput = Object.keys(patch.customValues).length > 0
      ? { customValues: patch.customValues }
      : {}

    await commandBus.execute<Record<string, unknown>, { interactionId: string }>('customers.interactions.update', {
      input: {
        id: mapping.interactionId,
        title: patch.title,
        priority: patch.priority,
        body: patch.body,
        ...customValuesInput,
        ...(strategy.updateStatusInCommand ? {
          status: patch.status,
          occurredAt: patch.occurredAt,
        } : {}),
      },
      ctx: commandContext,
    })

    if (strategy.lifecycleCommandId === 'customers.interactions.complete') {
      await commandBus.execute<Record<string, unknown>, { interactionId: string }>('customers.interactions.complete', {
        input: {
          id: mapping.interactionId,
          ...(patch.occurredAt ? { occurredAt: patch.occurredAt } : {}),
        },
        ctx: commandContext,
      })
    }

    await updateMappingAfterSync(em, {
      ...scope,
      interactionId: mapping.interactionId,
      todoId: mapping.todoId,
      sourceUpdatedAt: todo.updatedAt ?? null,
    })
  } catch (error) {
    const message = trimErrorMessage(error)
    const erroredMapping = await markMappingError(em, {
      scope,
      interactionId: mapping.interactionId,
      todoId: mapping.todoId,
      error: message,
      mapping,
      sourceUpdatedAt: todo?.updatedAt ?? null,
    })
    await emitSyncFailedEvent({
      scope,
      interactionId: erroredMapping.interactionId,
      todoId: erroredMapping.todoId,
      error: message,
      direction: 'inbound',
      eventId: payload.eventId,
    })
    throw error
  }
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}

function decodeCursor(token: string | undefined): CursorPayload | null {
  if (!token) return null
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as CursorPayload
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') return null
    return parsed
  } catch {
    /* malformed cursor token — treat as no cursor */
    return null
  }
}

async function loadLegacyExampleTodoLinks(
  container: ContainerLike,
  scope: ExampleCustomersSyncScope,
  limit: number,
  cursor?: string,
): Promise<{ rows: LegacyExampleTodoLinkRow[]; nextCursor?: string }> {
  const em = (container.resolve('em') as EntityManager).fork()
  const knex = em.getKnex()
  const parsedCursor = decodeCursor(cursor)
  const query = knex('customer_todo_links')
    .select<LegacyExampleTodoLinkRow[]>([
      'id',
      'entity_id as entityId',
      'todo_id as todoId',
      'created_by_user_id as createdByUserId',
      'created_at as createdAt',
    ])
    .where({
      tenant_id: scope.tenantId,
      organization_id: scope.organizationId,
      todo_source: 'example:todo',
    })
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .limit(limit + 1)

  if (parsedCursor) {
    query.andWhere(function applyCursor() {
      this.where('created_at', '>', new Date(parsedCursor.createdAt)).orWhere(function applyTieBreaker() {
        this.where('created_at', new Date(parsedCursor.createdAt)).andWhere('id', '>', parsedCursor.id)
      })
    })
  }

  const rows = await query
  const pageRows = rows.slice(0, limit)
  const next = rows.length > limit ? pageRows[pageRows.length - 1] : null
  return {
    rows: pageRows,
    ...(next ? { nextCursor: encodeCursor({ createdAt: next.createdAt.toISOString(), id: next.id }) } : {}),
  }
}

async function ensureCanonicalInteractionForLegacyLink(
  container: ContainerLike,
  scope: ExampleCustomersSyncScope,
  link: LegacyExampleTodoLinkRow,
): Promise<{ interactionId: string; created: boolean } | null> {
  const em = (container.resolve('em') as EntityManager).fork()
  const existing = await findOneWithDecryption(
    em,
    CustomerInteraction,
    {
      id: link.todoId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (existing) {
    return { interactionId: existing.id, created: false }
  }

  const todo = await loadExampleTodoSnapshot(em, scope, link.todoId)
  if (!todo) return null

  const patch = buildInteractionUpdateFromExampleTodo({
    title: todo.title,
    isDone: todo.isDone,
    customValues: todo.customValues,
    occurredAt: todo.isDone ? (todo.updatedAt ?? link.createdAt) : null,
  })

  const commandBus = container.resolve('commandBus') as CommandBus
  const commandContext = buildExampleCustomersSyncCommandContext(
    container as never,
    scope,
    EXAMPLE_CUSTOMERS_SYNC_INBOUND_ORIGIN,
  )
  try {
    const result = await commandBus.execute<Record<string, unknown>, { interactionId: string }>('customers.interactions.create', {
      input: {
        id: link.todoId,
        entityId: link.entityId,
        interactionType: CUSTOMER_INTERACTION_TASK_TYPE,
        title: patch.title,
        status: patch.status,
        occurredAt: patch.occurredAt,
        priority: patch.priority,
        body: patch.body,
        source: CUSTOMER_INTERACTION_TODO_ADAPTER_SOURCE,
        authorUserId: link.createdByUserId ?? null,
        ...(Object.keys(patch.customValues).length > 0 ? { customValues: patch.customValues } : {}),
      },
      ctx: commandContext,
    })
    return { interactionId: result.result.interactionId, created: true }
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error
    const existingAfterDuplicate = await findOneWithDecryption(
      em,
      CustomerInteraction,
      {
        id: link.todoId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    if (!existingAfterDuplicate) throw error
    return { interactionId: existingAfterDuplicate.id, created: false }
  }
}

async function ensureMappingForLegacyExampleTodo(
  container: ContainerLike,
  scope: ExampleCustomersSyncScope,
  todoId: string,
): Promise<ExampleCustomerInteractionMapping | null> {
  const em = (container.resolve('em') as EntityManager).fork()
  const legacyLink = await loadLegacyExampleTodoLinkRow(em, scope, todoId)
  if (!legacyLink) return null
  const canonical = await ensureCanonicalInteractionForLegacyLink(container, scope, legacyLink)
  if (!canonical) return null
  const todo = await loadExampleTodoSnapshot(em, scope, todoId)
  return await updateMappingAfterSync(em, {
    ...scope,
    interactionId: canonical.interactionId,
    todoId,
    sourceUpdatedAt: todo?.updatedAt ?? legacyLink.createdAt,
  })
}

export async function reconcileLegacyExampleTodoLinks(
  container: ContainerLike,
  input: ExampleCustomersSyncScope & { limit?: number; cursor?: string },
): Promise<ExampleCustomersSyncReconcileResult> {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500)
  const { rows, nextCursor } = await loadLegacyExampleTodoLinks(container, scope, limit, input.cursor)
  const em = (container.resolve('em') as EntityManager).fork()
  const items: ExampleCustomersSyncReconcileItem[] = []
  let mapped = 0
  let createdInteractions = 0
  let failed = 0

  for (const row of rows) {
    try {
      const mapping =
        await findMappingByTodoId(em, scope, row.todoId)
        ?? await findMappingByInteractionId(em, scope, row.todoId)
      const canonical = await ensureCanonicalInteractionForLegacyLink(container, scope, row)
      if (!canonical) {
        items.push({
          linkId: row.id,
          todoId: row.todoId,
          interactionId: null,
          status: 'skipped',
          message: 'Example todo not found',
        })
        continue
      }

      const todo = await loadExampleTodoSnapshot(em, scope, row.todoId)
      const updatedMapping = await updateMappingAfterSync(em, {
        ...scope,
        interactionId: canonical.interactionId,
        todoId: row.todoId,
        sourceUpdatedAt: todo?.updatedAt ?? row.createdAt,
      })
      items.push({
        linkId: row.id,
        todoId: row.todoId,
        interactionId: updatedMapping.interactionId,
        status: canonical.created ? 'created_interaction' : 'mapped',
        message: mapping ? 'Updated existing mapping' : null,
      })
      mapped += 1
      if (canonical.created) createdInteractions += 1
    } catch (error) {
      failed += 1
      items.push({
        linkId: row.id,
        todoId: row.todoId,
        interactionId: null,
        status: 'failed',
        message: trimErrorMessage(error),
      })
    }
  }

  return {
    items,
    processed: rows.length,
    mapped,
    createdInteractions,
    failed,
    ...(nextCursor ? { nextCursor } : {}),
  }
}

export function shouldEnqueueOutboundSync(payload: {
  id?: string | null
  interactionType?: string | null
  tenantId?: string | null
  organizationId?: string | null
  syncOrigin?: string | null
}): payload is {
  id: string
  interactionType: string
  tenantId: string
  organizationId: string
  syncOrigin?: string | null
} {
  return (
    typeof payload.id === 'string'
    && typeof payload.tenantId === 'string'
    && typeof payload.organizationId === 'string'
    && isTaskEventPayload(payload)
    && !isSyncOriginFromBridge(payload.syncOrigin)
  )
}

export function shouldEnqueueInboundSync(payload: {
  id?: string | null
  tenantId?: string | null
  organizationId?: string | null
  syncOrigin?: string | null
}): payload is {
  id: string
  tenantId: string
  organizationId: string
  syncOrigin?: string | null
} {
  return (
    typeof payload.id === 'string'
    && typeof payload.tenantId === 'string'
    && typeof payload.organizationId === 'string'
    && !isSyncOriginFromBridge(payload.syncOrigin)
  )
}
