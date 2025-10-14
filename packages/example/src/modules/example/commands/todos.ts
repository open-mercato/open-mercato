import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { z } from 'zod'
import { Todo } from '@open-mercato/example/modules/example/data/entities'
import { E } from '@open-mercato/example/datamodel/entities'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export const todoCreateSchema = z.object({
  title: z.string().min(1),
  is_done: z.boolean().optional(),
})

export const todoUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).optional(),
  is_done: z.boolean().optional(),
})

type SerializedTodo = {
  id: string
  title: string
  is_done: boolean
  tenantId: string | null
  organizationId: string | null
}

export const todoCrudEvents: CrudEventsConfig<Todo> = {
  module: 'example',
  entity: 'todo',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<Todo>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

export const todoCrudIndexer: CrudIndexerConfig<Todo> = {
  entityType: E.example.todo,
  buildUpsertPayload: (ctx: CrudEmitContext<Todo>) => ({
    entityType: E.example.todo,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
  buildDeletePayload: (ctx: CrudEmitContext<Todo>) => ({
    entityType: E.example.todo,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

const createTodoCommand: CommandHandler<Record<string, unknown>, Todo> = {
  id: 'example.todos.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(todoCreateSchema, rawInput)
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve<DataEngine>('dataEngine')

    const todo = await de.createOrmEntity({
      entity: Todo,
      data: {
        title: parsed.title,
        isDone: parsed.is_done ?? false,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
    })

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.example.todo,
      recordId: String(todo.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: todo,
      identifiers: {
        id: String(todo.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      events: todoCrudEvents,
      indexer: todoCrudIndexer,
    })

    return todo
  },
  captureAfter: (_input, result) => serializeTodo(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('example.audit.todos.create', 'Create todo'),
      resourceKind: 'example.todo',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      organizationId: result.organizationId ? String(result.organizationId) : null,
      snapshotAfter: serializeTodo(result),
    }
  },
  async undo({ logEntry, ctx }) {
    const snapshot = logEntry.snapshotAfter as SerializedTodo | undefined
    const id = snapshot?.id ?? logEntry.resourceId
    if (!id) throw new Error('Missing todo id for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await de.deleteOrmEntity({
      entity: Todo,
      where: {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<Todo>,
      soft: true,
      softDeleteField: 'deletedAt',
    })
  },
}

const updateTodoCommand: CommandHandler<Record<string, unknown>, Todo> = {
  id: 'example.todos.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(todoUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const existing = await em.findOne(Todo, { id: parsed.id, deletedAt: null } as FilterQuery<Todo>)
    if (!existing) throw new CrudHttpError(404, { error: 'Todo not found' })
    return { before: serializeTodo(existing) }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(todoUpdateSchema, rawInput)
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve<DataEngine>('dataEngine')

    const todo = await de.updateOrmEntity({
      entity: Todo,
      where: {
        id: parsed.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<Todo>,
      apply: (entity) => {
        if (parsed.title !== undefined) entity.title = parsed.title
        if (parsed.is_done !== undefined) entity.isDone = parsed.is_done
      },
    })
    if (!todo) throw new CrudHttpError(404, { error: 'Todo not found' })

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.example.todo,
      recordId: String(todo.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: todo,
      identifiers: {
        id: String(todo.id),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      events: todoCrudEvents,
      indexer: todoCrudIndexer,
    })

    return todo
  },
  captureAfter: (_input, result) => serializeTodo(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedTodo | undefined
    const after = serializeTodo(result)
    const changes = buildChanges(before ?? null, after as unknown as Record<string, unknown>, ['title', 'is_done'])
    return {
      actionLabel: translate('example.audit.todos.update', 'Update todo'),
      resourceKind: 'example.todo',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      organizationId: result.organizationId ? String(result.organizationId) : null,
      changes,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
  async undo({ logEntry, ctx }) {
    const before = logEntry.snapshotBefore as SerializedTodo | undefined
    if (!before?.id) throw new Error('Missing previous snapshot for undo')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve<DataEngine>('dataEngine')
    await de.updateOrmEntity({
      entity: Todo,
      where: {
        id: before.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<Todo>,
      apply: (entity) => {
        entity.title = before.title
        entity.isDone = before.is_done
        entity.tenantId = before.tenantId
        entity.organizationId = before.organizationId
      },
    })
  },
}

const deleteTodoCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, Todo> = {
  id: 'example.todos.delete',
  isUndoable: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'Todo id required')
    const em = ctx.container.resolve<EntityManager>('em')
    const existing = await em.findOne(Todo, { id, deletedAt: null } as FilterQuery<Todo>)
    if (!existing) return {}
    return { before: serializeTodo(existing) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Todo id required')
    const scope = ensureScope(ctx)
    const de = ctx.container.resolve<DataEngine>('dataEngine')
    const todo = await de.deleteOrmEntity({
      entity: Todo,
      where: {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<Todo>,
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!todo) throw new CrudHttpError(404, { error: 'Todo not found' })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: todo,
      identifiers: {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      events: todoCrudEvents,
      indexer: todoCrudIndexer,
    })

    return todo
  },
  buildLog: async ({ snapshots, input }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedTodo | undefined
    const id = requireId(input, 'Todo id required')
    return {
      actionLabel: translate('example.audit.todos.delete', 'Delete todo'),
      resourceKind: 'example.todo',
      resourceId: id,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
    }
  },
  async undo({ logEntry, ctx }) {
    const before = logEntry.snapshotBefore as SerializedTodo | undefined
    if (!before?.id) throw new Error('Missing snapshot for undo')
    const scope = ensureScope(ctx)
    const em = ctx.container.resolve<EntityManager>('em')
    const de = ctx.container.resolve<DataEngine>('dataEngine')
    const existing = await em.findOne(Todo, {
      id: before.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<Todo>)
    if (existing) {
      existing.deletedAt = null
      existing.title = before.title
      existing.isDone = before.is_done
      existing.tenantId = before.tenantId
      existing.organizationId = before.organizationId
      await em.persistAndFlush(existing)
      return
    }
    await de.createOrmEntity({
      entity: Todo,
      data: {
        id: before.id,
        title: before.title,
        isDone: before.is_done,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
    })
  },
}

registerCommand(createTodoCommand)
registerCommand(updateTodoCommand)
registerCommand(deleteTodoCommand)

function serializeTodo(todo: Todo): SerializedTodo {
  return {
    id: String(todo.id),
    title: String(todo.title),
    is_done: !!todo.isDone,
    tenantId: todo.tenantId ? String(todo.tenantId) : null,
    organizationId: todo.organizationId ? String(todo.organizationId) : null,
  }
}

function ensureScope(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant context is required' })
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization context is required' })
  return { tenantId, organizationId }
}
