import '@open-mercato/example/modules/example/commands/todos'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ZodError } from 'zod'
import { CustomerTodoLink } from '../data/entities'
import {
  todoLinkCreateSchema,
  todoLinkWithTodoCreateSchema,
  type TodoLinkCreateInput,
  type TodoLinkWithTodoCreateInput,
} from '../data/validators'
import {
  ensureOrganizationScope,
  ensureTenantScope,
  ensureSameScope,
  extractUndoPayload,
  requireCustomerEntity,
} from './shared'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CommandHandler as ExampleCommandHandler } from '@open-mercato/shared/lib/commands'
import type { Todo } from '@open-mercato/example/modules/example/data/entities'

type TodoSnapshot = {
  id: string
  title: string
  is_done: boolean
  tenantId: string | null
  organizationId: string | null
  custom?: Record<string, unknown>
}

type TodoLinkSnapshot = {
  id: string
  entityId: string
  organizationId: string
  tenantId: string
  todoId: string
  todoSource: string
  createdByUserId: string | null
}

type LinkedTodoUndoPayload = {
  todo?: TodoSnapshot | null
  link?: TodoLinkSnapshot | null
}

const DEFAULT_TODO_SOURCE = 'example:todo'

const isZodRuntimeMissing = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false
  const message = typeof (err as { message?: unknown }).message === 'string' ? (err as { message: string }).message : ''
  const name = typeof (err as { name?: unknown }).name === 'string' ? (err as { name: string }).name : ''
  return message.includes('_zod') && (name === 'TypeError' || err instanceof TypeError)
}

type ValidationRuntimeState = { available: boolean | null; warningLogged: boolean }

const commandTodoCreateValidationState: ValidationRuntimeState = { available: null, warningLogged: false }
const commandTodoLinkValidationState: ValidationRuntimeState = { available: null, warningLogged: false }

function ensureString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value
  return null
}

function ensureRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function normalizeTodoCreateCommandInput(raw: unknown): TodoLinkWithTodoCreateInput {
  if (!raw || typeof raw !== 'object') {
    throw new CrudHttpError(400, { error: 'Invalid todo payload' })
  }
  const payload = raw as Record<string, unknown>
  const tenantId = ensureString(payload.tenantId)
  const organizationId = ensureString(payload.organizationId)
  const entityId = ensureString(payload.entityId)
  const titleRaw = typeof payload.title === 'string' ? payload.title : ''
  const title = titleRaw.trim()
  if (!tenantId || !organizationId || !entityId || !title) {
    throw new CrudHttpError(400, { error: 'Invalid todo payload' })
  }
  const todoSource = ensureString(payload.todoSource) ?? DEFAULT_TODO_SOURCE
  const isDone = typeof payload.isDone === 'boolean'
    ? payload.isDone
    : typeof payload.is_done === 'boolean'
      ? payload.is_done
      : undefined
  const createdByUserId = ensureString(payload.createdByUserId) ?? undefined
  const todoCustom = ensureRecord(payload.todoCustom)
  const custom = ensureRecord(payload.custom)

  const result: TodoLinkWithTodoCreateInput = {
    tenantId,
    organizationId,
    entityId,
    title,
    todoSource,
  }
  if (isDone !== undefined) result.isDone = isDone
  if (createdByUserId) result.createdByUserId = createdByUserId
  if (todoCustom) result.todoCustom = todoCustom
  if (custom) result.custom = custom
  return result
}

function normalizeTodoLinkCommandInput(raw: unknown): TodoLinkCreateInput {
  if (!raw || typeof raw !== 'object') {
    throw new CrudHttpError(400, { error: 'Invalid todo link payload' })
  }
  const payload = raw as Record<string, unknown>
  const tenantId = ensureString(payload.tenantId)
  const organizationId = ensureString(payload.organizationId)
  const entityId = ensureString(payload.entityId)
  const todoId = ensureString(payload.todoId)
  if (!tenantId || !organizationId || !entityId || !todoId) {
    throw new CrudHttpError(400, { error: 'Invalid todo link payload' })
  }
  const todoSource = ensureString(payload.todoSource) ?? DEFAULT_TODO_SOURCE
  const createdByUserId = ensureString(payload.createdByUserId) ?? undefined
  const result: TodoLinkCreateInput = {
    tenantId,
    organizationId,
    entityId,
    todoId,
    todoSource,
  }
  if (createdByUserId) result.createdByUserId = createdByUserId
  return result
}

function parseTodoCreateCommandInput(raw: unknown): TodoLinkWithTodoCreateInput {
  const shouldValidate = commandTodoCreateValidationState.available !== false
  if (shouldValidate) {
    try {
      const parsed = todoLinkWithTodoCreateSchema.parse(raw)
      commandTodoCreateValidationState.available = true
      return parsed
    } catch (err) {
      if (err instanceof ZodError) throw err
      if (isZodRuntimeMissing(err)) {
        commandTodoCreateValidationState.available = false
        if (!commandTodoCreateValidationState.warningLogged) {
          commandTodoCreateValidationState.warningLogged = true
          console.warn('[customers.todos] command fallback to permissive todo create parser', err)
        }
      } else {
        throw err
      }
    }
  }
  return normalizeTodoCreateCommandInput(raw)
}

function parseTodoLinkCommandInput(raw: unknown): TodoLinkCreateInput {
  const shouldValidate = commandTodoLinkValidationState.available !== false
  if (shouldValidate) {
    try {
      const parsed = todoLinkCreateSchema.parse(raw)
      commandTodoLinkValidationState.available = true
      return parsed
    } catch (err) {
      if (err instanceof ZodError) throw err
      if (isZodRuntimeMissing(err)) {
        commandTodoLinkValidationState.available = false
        if (!commandTodoLinkValidationState.warningLogged) {
          commandTodoLinkValidationState.warningLogged = true
          console.warn('[customers.todos] command fallback to permissive todo link parser', err)
        }
      } else {
        throw err
      }
    }
  }
  return normalizeTodoLinkCommandInput(raw)
}

async function loadTodoLinkSnapshot(em: EntityManager, id: string): Promise<TodoLinkSnapshot | null> {
  const link = await em.findOne(CustomerTodoLink, { id })
  if (!link) return null
  return {
    id: link.id,
    entityId: typeof link.entity === 'string' ? link.entity : link.entity.id,
    organizationId: link.organizationId,
    tenantId: link.tenantId,
    todoId: link.todoId,
    todoSource: link.todoSource,
    createdByUserId: link.createdByUserId ?? null,
  }
}

function resolveExampleCreateHandler(): ExampleCommandHandler<Record<string, unknown>, Todo> {
  const handler = commandRegistry.get<Record<string, unknown>, Todo>('example.todos.create') as ExampleCommandHandler<
    Record<string, unknown>,
    Todo
  >
  if (!handler) throw new Error('example.todos.create handler not registered')
  return handler
}

function serializeTodoSnapshot(snapshot: unknown): TodoSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const record = snapshot as Record<string, unknown>
  return {
    id: String(record.id ?? ''),
    title: String(record.title ?? ''),
    is_done: Boolean(record.is_done ?? record.isDone ?? false),
    tenantId: record.tenantId ? String(record.tenantId) : null,
    organizationId: record.organizationId ? String(record.organizationId) : null,
    custom: (record.custom as Record<string, unknown> | undefined) ?? undefined,
  }
}

const createLinkedTodoCommand: CommandHandler<TodoLinkWithTodoCreateInput, { todoId: string; linkId: string; todoSnapshot: TodoSnapshot }> = {
  id: 'customers.todos.create',
  async execute(rawInput, ctx) {
    const parsed = parseTodoCreateCommandInput(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)

    const exampleCreate = resolveExampleCreateHandler()
    const isDone = parsed.isDone ?? parsed.is_done ?? false
    const todoCustom = parsed.todoCustom ?? parsed.custom

    const exampleInput: Record<string, unknown> = {
      title: parsed.title,
      is_done: isDone,
    }
    if (todoCustom && Object.keys(todoCustom).length) {
      exampleInput.custom = todoCustom
    }

    const todo = await exampleCreate.execute(exampleInput, ctx)
    const rawTodoSnapshot =
      (await exampleCreate.captureAfter?.(exampleInput, todo, ctx)) ?? { id: todo.id, title: todo.title, is_done: todo.isDone }
    let serializedTodo = serializeTodoSnapshot(rawTodoSnapshot)
    if (!serializedTodo) {
      serializedTodo = {
        id: String(todo.id),
        title: todo.title,
        is_done: isDone,
        tenantId: parsed.tenantId ?? null,
        organizationId: parsed.organizationId ?? null,
        custom: todoCustom ?? undefined,
      }
    } else {
      serializedTodo.tenantId = serializedTodo.tenantId ?? parsed.tenantId ?? null
      serializedTodo.organizationId = serializedTodo.organizationId ?? parsed.organizationId ?? null
      if (todoCustom && !serializedTodo.custom) serializedTodo.custom = todoCustom
    }

    const todoSource = parsed.todoSource ?? DEFAULT_TODO_SOURCE
    const link = em.create(CustomerTodoLink, {
      entity,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      todoId: String(todo.id),
      todoSource,
      createdByUserId: parsed.createdByUserId ?? null,
    })
    em.persist(link)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: link,
      identifiers: {
        id: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      },
    })

    return { todoId: String(todo.id), linkId: link.id, todoSnapshot: serializedTodo }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return await loadTodoLinkSnapshot(em, result.linkId)
  },
  buildLog: async ({ result, ctx, input }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const linkSnapshot = await loadTodoLinkSnapshot(em, result.linkId)

    return {
      actionLabel: translate('customers.audit.todos.link', 'Link todo'),
      resourceKind: 'customers.todoLink',
      resourceId: result.linkId,
      tenantId: linkSnapshot?.tenantId ?? null,
      organizationId: linkSnapshot?.organizationId ?? null,
      snapshotAfter: linkSnapshot ?? null,
      payload: {
        undo: {
          link: linkSnapshot ?? null,
          todo: result.todoSnapshot ?? null,
        } satisfies LinkedTodoUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LinkedTodoUndoPayload>(logEntry)
    if (!payload) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)

    if (payload.link) {
      await em.nativeDelete(CustomerTodoLink, { id: payload.link.id })
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: null,
        identifiers: {
          id: payload.link.id,
          organizationId: payload.link.organizationId,
          tenantId: payload.link.tenantId,
        },
      })
    }

    if (payload.todo) {
      const exampleCreate = resolveExampleCreateHandler()
      if (typeof exampleCreate.undo === 'function') {
        await exampleCreate.undo({
          input: {},
          ctx,
          logEntry: {
            commandId: 'example.todos.create',
            resourceId: payload.todo.id,
            commandPayload: { undo: { after: { ...payload.todo } } },
            snapshotAfter: { ...payload.todo },
          } as any,
        })
      }
    }
  },
}

const linkExistingTodoCommand: CommandHandler<TodoLinkCreateInput, { linkId: string }> = {
  id: 'customers.todos.link',
  async execute(rawInput, ctx) {
    const parsed = parseTodoLinkCommandInput(rawInput)
    ensureTenantScope(ctx, parsed.tenantId)
    ensureOrganizationScope(ctx, parsed.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await requireCustomerEntity(em, parsed.entityId, undefined, 'Customer not found')
    ensureSameScope(entity, parsed.organizationId, parsed.tenantId)

    const todoSource = parsed.todoSource ?? DEFAULT_TODO_SOURCE
    const existing = await em.findOne(CustomerTodoLink, {
      entity,
      todoId: parsed.todoId,
      todoSource,
    })
    if (existing) throw new CrudHttpError(409, { error: 'Todo already linked' })

    const link = em.create(CustomerTodoLink, {
      entity,
      organizationId: parsed.organizationId,
      tenantId: parsed.tenantId,
      todoId: parsed.todoId,
      todoSource,
      createdByUserId: parsed.createdByUserId ?? null,
    })
    em.persist(link)
    await em.flush()

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: link,
      identifiers: {
        id: link.id,
        organizationId: link.organizationId,
        tenantId: link.tenantId,
      },
    })

    return { linkId: link.id }
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager)
    return await loadTodoLinkSnapshot(em, result.linkId)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager)
    const snapshot = await loadTodoLinkSnapshot(em, result.linkId)
    return {
      actionLabel: translate('customers.audit.todos.link', 'Link todo'),
      resourceKind: 'customers.todoLink',
      resourceId: result.linkId,
      tenantId: snapshot?.tenantId ?? null,
      organizationId: snapshot?.organizationId ?? null,
      snapshotAfter: snapshot ?? null,
      payload: {
        undo: {
          link: snapshot ?? null,
        } satisfies LinkedTodoUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<LinkedTodoUndoPayload>(logEntry)
    const link = payload?.link
    if (!link) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    await em.nativeDelete(CustomerTodoLink, { id: link.id })
  },
}

const unlinkTodoCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, { linkId: string | null }> =
  {
    id: 'customers.todos.unlink',
    async prepare(input, ctx) {
      const id = requireId(input, 'Todo link id required')
      const em = (ctx.container.resolve('em') as EntityManager)
      const snapshot = await loadTodoLinkSnapshot(em, id)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, 'Todo link id required')
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const link = await em.findOne(CustomerTodoLink, { id })
      if (!link) throw new CrudHttpError(404, { error: 'Todo link not found' })
      ensureTenantScope(ctx, link.tenantId)
      ensureOrganizationScope(ctx, link.organizationId)
      em.remove(link)
      await em.flush()

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: link,
        identifiers: {
          id: link.id,
          organizationId: link.organizationId,
          tenantId: link.tenantId,
        },
      })
      return { linkId: link.id ?? null }
    },
    buildLog: async ({ snapshots, ctx }) => {
      const before = snapshots.before as TodoLinkSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        actionLabel: translate('customers.audit.todos.unlink', 'Unlink todo'),
        resourceKind: 'customers.todoLink',
        resourceId: before.id,
        tenantId: before.tenantId,
        organizationId: before.organizationId,
        snapshotBefore: before,
        payload: {
          undo: {
            link: before,
          } satisfies LinkedTodoUndoPayload,
        },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<LinkedTodoUndoPayload>(logEntry)
      const link = payload?.link
      if (!link) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      let existing = await em.findOne(CustomerTodoLink, { id: link.id })
      if (!existing) {
        const entity = await requireCustomerEntity(em, link.entityId, undefined, 'Customer not found')
        ensureSameScope(entity, link.organizationId, link.tenantId)
        existing = em.create(CustomerTodoLink, {
          id: link.id,
          entity,
          organizationId: link.organizationId,
          tenantId: link.tenantId,
          todoId: link.todoId,
          todoSource: link.todoSource,
          createdByUserId: link.createdByUserId,
        })
        em.persist(existing)
        await em.flush()
      }

      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: existing,
        identifiers: {
          id: existing.id,
          organizationId: existing.organizationId,
          tenantId: existing.tenantId,
        },
      })
    },
  }

registerCommand(createLinkedTodoCommand)
registerCommand(linkExistingTodoCommand)
registerCommand(unlinkTodoCommand)
