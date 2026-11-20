import { isDeepStrictEqual } from 'node:util'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
  requireId,
  normalizeCustomFieldValues,
} from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { asValue } from 'awilix'
import { makeCreateRedo, resolveRedoSnapshot, restoreCreatedRow } from '@open-mercato/shared/lib/commands/redo'
import { CrudHttpError, conflict, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { assertOptimisticLock, enforceRecordGoneIsConflict } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { LockMode, type EntityData, type EntityManager, type FilterQuery } from '@mikro-orm/postgresql'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import { Todo } from '../data/entities'
import { todoNotesSchema } from '../data/validators'

const ENTITY_ID = 'example:todo' as const
import { onTransactionLifetimeComplete, ownsTransactionLifetime } from '@open-mercato/shared/lib/commands/transaction-lifetime'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
  diffCustomFieldChanges,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'

export const todoCreateSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  is_done: z.boolean().optional(),
  notes: todoNotesSchema.optional(),
})

export const todoUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  is_done: z.boolean().optional(),
  notes: todoNotesSchema.optional(),
  /**
   * Optional expected `updated_at` for command-level optimistic locking.
   *
   * Strictly additive: `assertOptimisticLock` is a documented no-op when the
   * expected token is absent, so every existing caller — the CRUD route, the AI
   * tools, the sync bridge — keeps its current behavior. The bulk-complete worker
   * supplies it so a queued job never silently overwrites an edit made after the
   * operation was queued.
   */
  expected_updated_at: z.string().min(1).optional(),
})

type SerializedTodo = {
  id: string
  title: string
  is_done: boolean
  // Plaintext in the snapshot on purpose: undo has to restore what the user typed,
  // and `audit_logs` encrypts `snapshot_before` / `snapshot_after` / `changes_json`
  // at rest through its own encryption map.
  notes?: string | null
  tenantId: string | null
  organizationId: string | null
  custom?: Record<string, unknown>
}

/**
 * Minimal slice of `TenantDataEncryptionService` this module needs.
 *
 * Declared structurally so `buildTodoUpdatePatch` stays a pure function that a
 * unit test can drive with a stub instead of a live KMS.
 */
export type TodoEncryptionService = {
  encryptEntityPayload: (
    entityId: string,
    payload: Record<string, unknown>,
    tenantId: string | null | undefined,
    organizationId?: string | null,
  ) => Promise<Record<string, unknown>>
}

function tryResolveTodoEncryptionService(ctx: CommandRuntimeContext): TodoEncryptionService | null {
  try {
    return ctx.container.resolve('tenantEncryptionService') as TodoEncryptionService
  } catch {
    return null
  }
}

/**
 * Builds the column patch handed to `nativeUpdate`.
 *
 * `notes` is covered by this module's encryption map, and MikroORM documents
 * `nativeUpdate` as having no side effects on the context — which includes the
 * ORM lifecycle events the tenant-encryption subscriber listens on. A raw
 * `patch.notes = 'text'` would therefore land in the column as plaintext while
 * every read path decrypts it, so the value is encrypted here, explicitly,
 * through the shared service. `title` and `is_done` are not encrypted and pass
 * through untouched.
 *
 * `encryptEntityPayload` is a no-op when encryption is disabled, when the tenant
 * has no DEK, or when no map covers the entity. Sensitive notes must fail closed
 * in every one of those cases: accepting the unchanged value would write
 * plaintext into a column the module declares as encrypted at rest.
 */
export async function buildTodoUpdatePatch(
  input: { title?: string; isDone?: boolean; notes?: string | null },
  scope: { tenantId: string; organizationId: string },
  encryption: TodoEncryptionService | null,
): Promise<EntityData<Todo>> {
  const patch: EntityData<Todo> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.isDone !== undefined) patch.isDone = input.isDone
  if (input.notes !== undefined) {
    const plaintext = input.notes
    if (plaintext === null) {
      patch.notes = plaintext
    } else {
      if (!encryption) throw new Error('[internal] Todo notes encryption service is unavailable')
      const encrypted = await encryption.encryptEntityPayload(
        ENTITY_ID,
        { notes: plaintext },
        scope.tenantId,
        scope.organizationId,
      )
      const stored = encrypted?.notes
      if (typeof stored !== 'string' || stored === plaintext) {
        throw new Error('[internal] Todo notes encryption did not produce ciphertext')
      }
      patch.notes = stored
    }
  }
  return patch
}

export const todoCrudEvents: CrudEventsConfig<Todo> = {
  module: 'example',
  entity: 'todo',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<Todo>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    title: ctx.entity?.title ?? null,
    isDone: typeof ctx.entity?.isDone === 'boolean' ? ctx.entity.isDone : null,
    ...(ctx.syncOrigin ? { syncOrigin: ctx.syncOrigin } : {}),
  }),
}

export const todoCrudIndexer: CrudIndexerConfig<Todo> = {
  entityType: ENTITY_ID,
  buildUpsertPayload: (ctx: CrudEmitContext<Todo>) => ({
    entityType: ENTITY_ID,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
  buildDeletePayload: (ctx: CrudEmitContext<Todo>) => ({
    entityType: ENTITY_ID,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

const redoLegacyTodoCreate = makeCreateRedo<Todo, SerializedTodo, Record<string, unknown>, Todo>({
  entityClass: Todo,
  getSnapshotId: (snapshot) => snapshot.id,
  seedFromSnapshot: todoSeedFromSnapshot,
  buildResult: (entity) => entity,
  events: todoCrudEvents,
  indexer: todoCrudIndexer,
  afterRestore: restoreTodoCreateFields,
})

async function restoreTodoCreateFields({ ctx, entity, snapshot }: {
  ctx: CommandRuntimeContext
  entity: Todo
  snapshot: SerializedTodo
}) {
  if (!snapshot.custom || !Object.keys(snapshot.custom).length) return
  const de = (ctx.container.resolve('dataEngine') as DataEngine)
  const values = normalizeCustomFieldValues(snapshot.custom)
  if (!Object.keys(values).length) return
  await de.setCustomFields({
    entityId: ENTITY_ID,
    recordId: String(entity.id),
    tenantId: entity.tenantId ? String(entity.tenantId) : null,
    organizationId: entity.organizationId ? String(entity.organizationId) : null,
    values,
    notify: false,
  })
}

const createTodoCommand: CommandHandler<Record<string, unknown>, Todo> = {
  id: 'example.todos.create',
  isUndoable: true,
  atomicReplay: true,
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(todoCreateSchema, rawInput)
    const scope = ensureScope(ctx)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const encryption = parsed.notes != null
      ? tryResolveTodoEncryptionService(ctx)
      : null
    const encryptedNotes = parsed.notes === undefined
      ? null
      : (await buildTodoUpdatePatch({ notes: parsed.notes }, scope, encryption)).notes ?? null

    await beforeTodoTransactionalWrite(ctx, rawInput)
    const todo = await de.createOrmEntity({
      entity: Todo,
      data: {
        ...(parsed.id ? { id: parsed.id } : {}),
        title: parsed.title,
        // Pre-encrypt so a missing map, DEK, or service fails before persistence.
        // The ORM subscriber recognizes authenticated ciphertext and leaves it
        // unchanged, so this does not double-encrypt on the normal create path.
        notes: encryptedNotes,
        isDone: parsed.is_done ?? false,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
    })

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: ENTITY_ID,
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
      syncOrigin: ctx.syncOrigin,
      events: todoCrudEvents,
      indexer: todoCrudIndexer,
    })

    return todo
  },
  captureAfter: async (input, result, ctx) => ctx.transactionalEm
    ? snapshotCreatedTodo(input, result, ctx.transactionalEm)
    : serializeTodo(result),
  buildLog: async ({ input, result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
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
      snapshotAfter: ctx.transactionalEm
        ? serializeTodo(result, custom, parseWithCustomFields(todoCreateSchema, input).parsed.notes ?? null)
        : serializeTodo(result, custom),
    }
  },
  async undo({ logEntry, ctx: caller }) {
    return withTodoReplayDataEngine(caller, async (ctx) => {
      const payload = (logEntry?.commandPayload as { undo?: { after?: SerializedTodo } } | undefined)?.undo
      const snapshot = (logEntry.snapshotAfter as SerializedTodo | undefined) ?? payload?.after
      const id = snapshot?.id ?? logEntry.resourceId
      if (!id) throw new Error('Missing todo id for undo')
      const scope = resolveTodoReplayScope(ctx, logEntry, snapshot)
      if (ctx.transactionalEm && !await readScopedTodo(ctx.transactionalEm, id, scope, { lock: true })) throw todoNotFound()
      const de = (ctx.container.resolve('dataEngine') as DataEngine)
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
        const rawValues = buildCustomFieldResetMap(undefined, snapshot.custom)
        const values = normalizeCustomFieldValues(rawValues)
        if (Object.keys(values).length) {
          await de.setCustomFields({
            entityId: ENTITY_ID,
            recordId: id,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            values,
            notify: false,
          })
        }
      }
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'deleted',
        entity: removed,
        identifiers: {
          id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        syncOrigin: ctx.syncOrigin,
        events: todoCrudEvents,
        indexer: todoCrudIndexer,
      })
    })
  },
  async redo(args) {
    if (!args.ctx.transactionalEm) return redoLegacyTodoCreate(args)
    const snapshot = resolveRedoSnapshot<SerializedTodo>(args.logEntry)
    if (!snapshot?.id) throw new CrudHttpError(400, { error: '[internal] Todo redo snapshot is unavailable' })
    const scope = resolveTodoReplayScope(args.ctx, args.logEntry, snapshot)
    return withTodoReplayDataEngine(args.ctx, async (ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      try {
        const notes = (await buildTodoUpdatePatch({ notes: snapshot.notes ?? null }, scope, tryResolveTodoEncryptionService(ctx))).notes ?? null
        const entity = await restoreCreatedRow(em, Todo, snapshot.id,
          () => ({ ...todoSeedFromSnapshot(snapshot), ...scope, notes }),
          (manager, id) => readScopedTodo(manager, id, scope, { lock: true, includeDeleted: true }))
        await em.flush()
        await restoreTodoCreateFields({ ctx, entity, snapshot })
        await emitCrudSideEffects({
          dataEngine: ctx.container.resolve<DataEngine>('dataEngine'),
          action: 'created',
          entity,
          identifiers: { id: snapshot.id, ...scope },
          syncOrigin: ctx.syncOrigin,
          events: todoCrudEvents,
          indexer: todoCrudIndexer,
        })
        return entity
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict('[internal] Cannot redo: a record with the same unique key already exists.')
        throw error
      }
    })
  },
}

const updateTodoCommand: CommandHandler<Record<string, unknown>, Todo> = {
  id: 'example.todos.update',
  isUndoable: true,
  atomicReplay: true,
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(todoUpdateSchema, rawInput)
    const scope = ensureScope(ctx)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager)
    // `notes` is encrypted at rest, so the undo snapshot has to be built from the
    // decrypted entity — a raw `em.findOne` would snapshot ciphertext and undo
    // would write it back as if it were the user's text.
    const existing = await findOneWithDecryption(em, Todo, {
      id: parsed.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<Todo>, ctx.transactionalEm ? todoWriteLock : undefined, scope)
    if (!existing) throw todoNotFound()
    // Runs in `prepare`, which the command bus always awaits before `execute`, so a
    // stale version aborts the write instead of racing it.
    assertOptimisticLock({
      resourceKind: ENTITY_ID,
      resourceId: parsed.id,
      expected: parsed.expected_updated_at,
      current: existing.updatedAt,
      envValue: ctx.crudFormSectionTargetVersionRequired ? 'all' : undefined,
    })
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
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const em = (ctx.container.resolve('em') as EntityManager)
    const locked = await beforeTodoTransactionalWrite(ctx, rawInput, parsed.id, parsed.expected_updated_at)
    const configured = ctx.crudFormSectionTargetVersionRequired ? locked : undefined
    const notes = configured && parsed.notes === (configured.notes ?? null) ? undefined : parsed.notes
    const patch = await buildTodoUpdatePatch({
      title: parsed.title === configured?.title ? undefined : parsed.title,
      isDone: parsed.is_done === configured?.isDone ? undefined : parsed.is_done,
      notes,
    }, scope, notes === undefined ? null : tryResolveTodoEncryptionService(ctx))
    const customUpdates = configured && ctx.transactionalEm
      ? await changedTodoCustomFields(ctx.transactionalEm, configured.id, scope, custom)
      : custom
    const touchVersion = !!ctx.transactionalEm && Object.keys(customUpdates).length > 0
    const todo = configured && !touchVersion && !Object.keys(patch).length
      ? configured
      : await writeTodoUpdate(ctx.transactionalEm ?? em.fork({ clear: true, freshEventManager: true }), {
        id: parsed.id,
        ...scope,
        patch,
        refresh: !!ctx.transactionalEm,
        previousVersion: locked?.updatedAt,
        touchVersion,
      })
    if (!todo) throw new CrudHttpError(404, { error: 'Todo not found' })

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: ENTITY_ID,
      recordId: String(todo.id),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      values: customUpdates,
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
      syncOrigin: ctx.syncOrigin,
      events: todoCrudEvents,
      indexer: todoCrudIndexer,
    })

    return todo
  },
  captureAfter: async (_input, result, ctx) => {
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
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
    const captured = ctx.transactionalEm ? snapshots.after as SerializedTodo | undefined : undefined
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager)
    const after = captured ?? serializeTodo(result, await loadTodoCustomSnapshot(
      em,
      String(result.id),
      result.tenantId ? String(result.tenantId) : null,
      result.organizationId ? String(result.organizationId) : null,
    ))
    const afterCustom = after.custom
    const changes = buildChanges(before ?? null, after as unknown as Record<string, unknown>, ['title', 'is_done', 'notes'])
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
  async undo({ logEntry, ctx: caller }) {
    return withTodoReplayDataEngine(caller, async (ctx) => {
      const payload = (logEntry?.commandPayload as { undo?: { before?: SerializedTodo; after?: SerializedTodo } } | undefined)?.undo
      const before = (logEntry.snapshotBefore as SerializedTodo | undefined) ?? payload?.before
      if (!before?.id) throw new Error('Missing previous snapshot for undo')
      const scope = resolveTodoReplayScope(ctx, logEntry, before)
      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      if (ctx.transactionalEm && !await readScopedTodo(ctx.transactionalEm, before.id, scope, { lock: true })) throw todoNotFound()
      const after = (logEntry.snapshotAfter as SerializedTodo | undefined) ?? payload?.after
      const updated = await de.updateOrmEntity({
        entity: Todo,
        where: {
          id: before.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        } as FilterQuery<Todo>,
        // `updateOrmEntity` persists through the request `EntityManager`, so the
        // `beforeUpdate` encryption hook re-encrypts `notes` on the way back down.
        apply: (entity) => {
          entity.title = before.title
          entity.isDone = before.is_done
          entity.notes = before.notes ?? null
          entity.tenantId = before.tenantId ?? scope.tenantId
          entity.organizationId = before.organizationId ?? scope.organizationId
        },
      })
      const customResetValues = buildCustomFieldResetMap(before.custom, after?.custom)
      const customValues = normalizeCustomFieldValues(customResetValues)
      if (Object.keys(customValues).length > 0) {
        await de.setCustomFields({
          entityId: ENTITY_ID,
          recordId: before.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          values: customValues,
          notify: false,
        })
      }
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: updated,
        identifiers: {
          id: before.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        syncOrigin: ctx.syncOrigin,
        events: todoCrudEvents,
        indexer: todoCrudIndexer,
      })
    })
  },
  async redo({ input, ctx }) {
    return withTodoReplayDataEngine(ctx, (scoped) => updateTodoCommand.execute(input, scoped))
  },
}

const deleteTodoCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, Todo> = {
  id: 'example.todos.delete',
  isUndoable: true,
  atomicReplay: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'Todo id required')
    const scope = ensureScope(ctx)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager)
    // Same reason as the update `prepare`: the delete-undo snapshot must hold the
    // plaintext `notes`, not the stored ciphertext.
    const existing = await findOneWithDecryption(em, Todo, {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    } as FilterQuery<Todo>, ctx.transactionalEm ? todoWriteLock : undefined, scope)
    if (!existing) {
      if (ctx.transactionalEm) throw todoNotFound()
      return {}
    }
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
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const expected = input.body?.expected_updated_at
    await beforeTodoTransactionalWrite(ctx, input, id, typeof expected === 'string' ? expected : undefined)
    const todo = await de.deleteOrmEntity({
      entity: Todo,
      where: {
        id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as FilterQuery<Todo>,
      soft: !isConfiguredTodoHardDelete(ctx),
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
      syncOrigin: ctx.syncOrigin,
      events: todoCrudEvents,
      indexer: todoCrudIndexer,
    })

    return todo
  },
  buildLog: async ({ snapshots, input, ctx }) => {
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
      ...(isConfiguredTodoHardDelete(ctx) ? { context: { exampleTodoDeleteMode: 'hard' } } : {}),
    }
  },
  async undo({ logEntry, ctx: caller }) {
    return withTodoReplayDataEngine(caller, async (ctx) => {
      const before = logEntry.snapshotBefore as SerializedTodo | undefined
      if (!before?.id) throw new Error('Missing snapshot for undo')
      const scope = resolveTodoReplayScope(ctx, logEntry, before)
      const em = (ctx.container.resolve('em') as EntityManager)
      const de = (ctx.container.resolve('dataEngine') as DataEngine)
      let restored = ctx.transactionalEm
        ? await readScopedTodo(em, before.id, scope, { lock: true, includeDeleted: true })
        : await em.findOne(Todo, { id: before.id, ...scope } as FilterQuery<Todo>)
      if (ctx.transactionalEm && restored && !restored.deletedAt) throw conflict('[internal] Todo already exists')
      if (restored) {
        restored.deletedAt = null
        restored.title = before.title
        restored.isDone = before.is_done
        restored.notes = before.notes ?? null
        restored.tenantId = before.tenantId ?? scope.tenantId
        restored.organizationId = before.organizationId ?? scope.organizationId
        await em.persist(restored).flush()
      } else {
        restored = await de.createOrmEntity({
          entity: Todo,
          data: {
            id: before.id,
            title: before.title,
            isDone: before.is_done,
            notes: before.notes ?? null,
            tenantId: before.tenantId ?? scope.tenantId,
            organizationId: before.organizationId ?? scope.organizationId,
          },
        })
      }
      if (before.custom && Object.keys(before.custom).length > 0) {
        const values = normalizeCustomFieldValues(before.custom)
        await de.setCustomFields({
          entityId: ENTITY_ID,
          recordId: before.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          values,
          notify: false,
        })
      }
      await emitCrudUndoSideEffects({
        dataEngine: de,
        action: 'updated',
        entity: restored,
        identifiers: {
          id: before.id,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        },
        syncOrigin: ctx.syncOrigin,
        events: todoCrudEvents,
        indexer: todoCrudIndexer,
      })
    })
  },
  async redo({ input, ctx, logEntry }) {
    return withTodoReplayDataEngine(ctx, (scoped) => deleteTodoCommand.execute(input, {
      ...scoped,
      crudFormSectionDeleteMode: logEntry.contextJson?.exampleTodoDeleteMode === 'hard' ? 'hard' : undefined,
    }))
  },
}

registerCommand(createTodoCommand)
registerCommand(updateTodoCommand)
registerCommand(deleteTodoCommand)

const todoWriteLock = { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true } as const

function todoNotFound(): CrudHttpError {
  return new CrudHttpError(404, { error: 'Todo not found' })
}

function readScopedTodo(
  em: EntityManager,
  id: string,
  scope: { tenantId: string; organizationId: string },
  options: { lock?: boolean; includeDeleted?: boolean } = {},
) {
  return findOneWithDecryption(em, Todo,
    { id, ...scope, ...(options.includeDeleted ? {} : { deletedAt: null }) },
    options.lock ? todoWriteLock : undefined,
    scope,
  )
}

async function beforeTodoTransactionalWrite(ctx: CommandRuntimeContext, input: unknown, id?: string, expected?: string) {
  const em = ctx.transactionalEm
  if (!em) return
  if (!ownsTransactionLifetime(em, ctx.transactionLifetime)) {
    throw new Error('[internal] Todo write requires the owned transaction')
  }
  const current = id ? await readScopedTodo(em, id, ensureScope(ctx), { lock: true }) : null
  if (id) {
    const version = {
      resourceKind: ENTITY_ID, resourceId: id, expected,
      envValue: ctx.crudFormSectionTargetVersionRequired ? 'all' : undefined,
    }
    if (!current) {
      enforceRecordGoneIsConflict(version)
      throw todoNotFound()
    }
    assertOptimisticLock({ ...version, current: current.updatedAt })
  }
  await ctx.beforeTransactionalWrite?.(em, input)
  return current ?? undefined
}

async function changedTodoCustomFields(
  em: EntityManager, id: string, scope: { tenantId: string; organizationId: string }, custom: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!Object.keys(custom).length) return custom
  const stored = await loadTodoCustomSnapshot(em, id, scope.tenantId, scope.organizationId)
  return Object.fromEntries(Object.entries(normalizeCustomFieldValues(custom)).filter(([key, value]) =>
    value !== undefined && !isDeepStrictEqual(value, stored[key] ?? null)))
}

function isConfiguredTodoHardDelete(ctx: CommandRuntimeContext): boolean {
  return !!ctx.transactionalEm && ctx.crudFormSectionDeleteMode === 'hard'
    && ownsTransactionLifetime(ctx.transactionalEm, ctx.transactionLifetime)
}

async function snapshotCreatedTodo(input: Record<string, unknown>, todo: Todo, em: EntityManager) {
  const custom = await loadTodoCustomSnapshot(em, String(todo.id), todo.tenantId ?? null, todo.organizationId ?? null)
  return serializeTodo(todo, custom, parseWithCustomFields(todoCreateSchema, input).parsed.notes ?? null)
}

function resolveTodoReplayScope(ctx: CommandRuntimeContext, log: CommandUndoLogEntry, snapshot?: SerializedTodo) {
  if (!ctx.transactionalEm) return resolveUndoScope(ctx, snapshot)
  if (!snapshot || (log.resourceId && log.resourceId !== snapshot.id)
      || (log.tenantId && log.tenantId !== snapshot.tenantId)
      || (log.organizationId && log.organizationId !== snapshot.organizationId)) {
    throw new CrudHttpError(409, { error: 'record_conflict' })
  }
  const tenantId = ctx.auth?.tenantId
  if (!tenantId || !snapshot.tenantId || snapshot.tenantId !== tenantId) {
    throw new CrudHttpError(403, { error: 'Undo scope does not match tenant' })
  }
  const organizationId = snapshot.organizationId
  const allowed = ctx.organizationScope ? ctx.organizationScope.filterIds : ctx.organizationIds
  if (!organizationId || (Array.isArray(allowed) && !allowed.includes(organizationId))
      || (allowed === undefined && organizationId !== (ctx.selectedOrganizationId ?? ctx.auth?.orgId))) {
    throw new CrudHttpError(403, { error: 'Undo scope is not permitted for this organization' })
  }
  return { tenantId, organizationId }
}

async function withTodoReplayDataEngine<TResult>(
  ctx: CommandRuntimeContext,
  run: (scoped: CommandRuntimeContext) => TResult | Promise<TResult>,
): Promise<TResult> {
  const em = ctx.transactionalEm
  if (!em) return run(ctx)
  if (!ownsTransactionLifetime(em, ctx.transactionLifetime)) {
    throw new Error('[internal] Todo replay requires the owned transaction')
  }
  const container = ctx.container.createScope()
  let registered = false
  let completed = false
  try {
    container.register('em', asValue(em))
    const parent = ctx.container.resolve<DataEngine>('dataEngine')
    const scope = parent.createCommandTransactionScope?.(em, container)
    if (!scope || scope.dataEngine === parent) throw new Error('[internal] Todo replay requires an isolated data engine')
    container.register('dataEngine', asValue(scope.dataEngine))
    onTransactionLifetimeComplete(em, async (outcome) => {
      try {
        await scope.complete(completed ? outcome : 'rolled_back', ctx.bulkImport)
      } finally {
        await container.dispose()
      }
    })
    registered = true
    const result = await run({ ...ctx, container })
    completed = true
    return result
  } finally {
    if (!registered) await container.dispose()
  }
}

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

function todoSeedFromSnapshot(snapshot: SerializedTodo): Record<string, unknown> {
  return {
    id: snapshot.id,
    title: snapshot.title,
    isDone: snapshot.is_done,
    notes: snapshot.notes ?? null,
    tenantId: snapshot.tenantId,
    organizationId: snapshot.organizationId,
  }
}

function serializeTodo(todo: Todo, custom?: Record<string, unknown> | null, notes = todo.notes ?? null): SerializedTodo {
  const payload: SerializedTodo = {
    id: String(todo.id),
    title: String(todo.title),
    is_done: !!todo.isDone,
    notes,
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

// Uses nativeUpdate on a forked EntityManager to avoid flushing unrelated
// pending changes from the request-scoped EM. This is required when the
// sync bridge calls update inside a worker context where the shared EM may
// carry state from prior operations within the same job batch.
async function writeTodoUpdate(
  em: EntityManager,
  input: {
    id: string
    tenantId: string
    organizationId: string
    patch: EntityData<Todo>
    refresh: boolean
    touchVersion: boolean
    previousVersion?: Date
  },
): Promise<Todo | null> {
  const where = {
    id: input.id,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    deletedAt: null,
  } as FilterQuery<Todo>
  const patch: EntityData<Todo> = { ...input.patch }

  if (Object.keys(patch).length > 0 || input.touchVersion) {
    patch.updatedAt = new Date(Math.max(Date.now(), (input.previousVersion?.getTime() ?? 0) + 1))
    const updatedRows = await em.nativeUpdate(Todo, where, patch)
    if (updatedRows === 0) return null
  }

  // `freshEventManager: true` means this fork carries none of the runtime-registered
  // ORM subscribers, so the `onLoad` decryption hook never fires here. The explicit
  // helper is what turns the stored `notes` ciphertext back into plaintext for the
  // audit snapshot the caller builds from this entity.
  return await findOneWithDecryption(em, Todo, where, input.refresh ? { refresh: true } : undefined, {
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
}

async function loadTodoCustomSnapshot(
  em: EntityManager,
  id: string,
  tenantId: string | null,
  organizationId: string | null
): Promise<Record<string, unknown>> {
  return await loadCustomFieldSnapshot(em, {
    entityId: ENTITY_ID,
    recordId: id,
    tenantId,
    organizationId,
  })
}
