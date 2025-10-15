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
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
  diffCustomFieldChanges,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'

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
  custom?: Record<string, unknown>
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
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = ctx.container.resolve<EntityManager>('em')
    const custom = await loadTodoCustomSnapshot(
      em,
      String(result.id),
      result.tenantId ? String(result.tenantId) : null,
      result.organizationId ? String(result.organizationId) : null
    )
    return {
      actionLabel: translate('example.audit.todos.create', 'Create todo'),
      resourceKind: 'example.todo',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      organizationId: result.organizationId ? String(result.organizationId) : null,
      snapshotAfter: serializeTodo(result, custom),
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = (logEntry?.commandPayload as { undo?: { after?: SerializedTodo } } | undefined)?.undo
    const snapshot = (logEntry.snapshotAfter as SerializedTodo | undefined) ?? payload?.after
    const id = snapshot?.id ?? logEntry.resourceId
    if (!id) throw new Error('Missing todo id for undo')
    const scope = resolveUndoScope(ctx, snapshot)
    const de = ctx.container.resolve<DataEngine>('dataEngine')
    const removed = await de.deleteOrmEntity({
      entity: Todo,
      where: {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      } as FilterQuery<Todo>,
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (snapshot?.custom && Object.keys(snapshot.custom).length) {
      const values = buildCustomFieldResetMap(undefined, snapshot.custom)
      if (Object.keys(values).length) {
        await de.setCustomFields({
          entityId: E.example.todo,
          recordId: id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          values,
          notify: false,
        })
      }
    }
    if (removed) {
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: removed,
        identifiers: {
          id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        events: todoCrudEvents,
        indexer: todoCrudIndexer,
      })
    }
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
    const custom = await loadTodoCustomSnapshot(
      em,
      String(existing.id),
      existing.tenantId ? String(existing.tenantId) : null,
      existing.organizationId ? String(existing.organizationId) : null
    )
    return { before: serializeTodo(existing, custom) }
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
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.container.resolve<EntityManager>('em')
    const custom = await loadTodoCustomSnapshot(
      em,
      String(result.id),
      result.tenantId ? String(result.tenantId) : null,
      result.organizationId ? String(result.organizationId) : null
    )
    return serializeTodo(result, custom)
  },
  buildLog: async ({ result, snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedTodo | undefined
    const em = ctx.container.resolve<EntityManager>('em')
    const afterCustom = await loadTodoCustomSnapshot(
      em,
      String(result.id),
      result.tenantId ? String(result.tenantId) : null,
      result.organizationId ? String(result.organizationId) : null
    )
    const after = serializeTodo(result, afterCustom)
    const changes = buildChanges(before ?? null, after as unknown as Record<string, unknown>, ['title', 'is_done'])
    const customDiff = diffCustomFieldChanges(before?.custom, afterCustom)
    for (const [key, diff] of Object.entries(customDiff)) {
      changes[`cf_${key}`] = diff
    }
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
    const payload = (logEntry?.commandPayload as { undo?: { before?: SerializedTodo; after?: SerializedTodo } } | undefined)?.undo
    const before = (logEntry.snapshotBefore as SerializedTodo | undefined) ?? payload?.before
    if (!before?.id) throw new Error('Missing previous snapshot for undo')
    const scope = resolveUndoScope(ctx, before)
    const de = ctx.container.resolve<DataEngine>('dataEngine')
    const after = (logEntry.snapshotAfter as SerializedTodo | undefined) ?? payload?.after
    const updated = await de.updateOrmEntity({
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
        entity.tenantId = before.tenantId ?? scope.tenantId
        entity.organizationId = before.organizationId ?? scope.organizationId
      },
    })
    const customValues = buildCustomFieldResetMap(before.custom, after?.custom)
    if (Object.keys(customValues).length > 0) {
      await de.setCustomFields({
        entityId: E.example.todo,
        recordId: before.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        values: customValues,
        notify: false,
      })
    }
    if (updated) {
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: updated,
        identifiers: {
          id: before.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        events: todoCrudEvents,
        indexer: todoCrudIndexer,
      })
    }
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
    const custom = await loadTodoCustomSnapshot(
      em,
      String(existing.id),
      existing.tenantId ? String(existing.tenantId) : null,
      existing.organizationId ? String(existing.organizationId) : null
    )
    return { before: serializeTodo(existing, custom) }
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
    const scope = resolveUndoScope(ctx, before)
    const em = ctx.container.resolve<EntityManager>('em')
    const de = ctx.container.resolve<DataEngine>('dataEngine')
    let restored = await em.findOne(Todo, {
      id: before.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as FilterQuery<Todo>)
    if (restored) {
      restored.deletedAt = null
      restored.title = before.title
      restored.isDone = before.is_done
      restored.tenantId = before.tenantId ?? scope.tenantId
      restored.organizationId = before.organizationId ?? scope.organizationId
      await em.persistAndFlush(restored)
    } else {
      restored = await de.createOrmEntity({
        entity: Todo,
        data: {
          id: before.id,
          title: before.title,
          isDone: before.is_done,
          tenantId: before.tenantId ?? scope.tenantId,
          organizationId: before.organizationId ?? scope.organizationId,
        },
      })
    }
    if (before.custom && Object.keys(before.custom).length > 0) {
      await de.setCustomFields({
        entityId: E.example.todo,
        recordId: before.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        values: before.custom,
        notify: false,
      })
    }
    if (restored) {
      await emitCrudSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: restored,
        identifiers: {
          id: before.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        events: todoCrudEvents,
        indexer: todoCrudIndexer,
      })
    }
  },
}

registerCommand(createTodoCommand)
registerCommand(updateTodoCommand)
registerCommand(deleteTodoCommand)

function resolveUndoScope(
  ctx: CommandRuntimeContext,
  snapshot?: { tenantId: string | null; organizationId: string | null }
): { tenantId: string; organizationId: string } {
  const scope = ensureScope(ctx)
  const tenantId = snapshot?.tenantId ?? scope.tenantId
  if (tenantId !== scope.tenantId) {
    throw new CrudHttpError(403, { error: 'Undo scope does not match tenant' })
  }
  let organizationId = scope.organizationId
  if (snapshot?.organizationId) {
    const allowed = Array.isArray(ctx.organizationIds) ? ctx.organizationIds : null
    if (allowed && allowed.length > 0 && !allowed.includes(snapshot.organizationId)) {
      throw new CrudHttpError(403, { error: 'Undo scope is not permitted for this organization' })
    }
    organizationId = snapshot.organizationId
  }
  return { tenantId, organizationId }
}

function serializeTodo(todo: Todo, custom?: Record<string, unknown> | null): SerializedTodo {
  const payload: SerializedTodo = {
    id: String(todo.id),
    title: String(todo.title),
    is_done: !!todo.isDone,
    tenantId: todo.tenantId ? String(todo.tenantId) : null,
    organizationId: todo.organizationId ? String(todo.organizationId) : null,
  }
  if (custom && Object.keys(custom).length > 0) payload.custom = custom
  return payload
}

function ensureScope(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'Tenant context is required' })
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: 'Organization context is required' })
  return { tenantId, organizationId }
}

async function loadTodoCustomSnapshot(
  em: EntityManager,
  id: string,
  tenantId: string | null,
  organizationId: string | null
): Promise<Record<string, unknown>> {
  return await loadCustomFieldSnapshot(em, {
    entityId: E.example.todo,
    recordId: id,
    tenantId,
    organizationId,
  })
}
