import type { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  buildChanges,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  parseWithCustomFields,
  requireId,
  setCustomFieldsIfAny,
} from '@open-mercato/shared/lib/commands/helpers'
import { diffCustomFieldChanges } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { makeCreateRedo, resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'

type Scope = { tenantId: string; organizationId: string }

/** Matches `makeCreateRedo`'s own entity constraint so redo can be built from these configs. */
type TimelineEntity = {
  id: string
  organizationId?: string | null
  tenantId?: string | null
  deletedAt?: Date | null
  isActive?: boolean
}

const forkEm = (ctx: CommandRuntimeContext) => (ctx.container.resolve('em') as EntityManager).fork()
const rawEm = (ctx: CommandRuntimeContext) => ctx.container.resolve('em') as EntityManager
const engine = (ctx: CommandRuntimeContext) => ctx.container.resolve('dataEngine') as DataEngine

/** Identity + scope triple every side-effect emitter and custom-field write needs. */
const idsOf = (row: { id: string } & Partial<Scope>) => ({
  id: row.id,
  organizationId: row.organizationId as string,
  tenantId: row.tenantId as string,
})

/**
 * The audit-log envelope shared by all three factories. Field names and nullability are
 * replayed from `action_logs` rows that already exist in customer databases, so this shape
 * is a frozen contract; only the values are supplied per family.
 */
function timelineLogEnvelope(args: {
  label: readonly [string, string]
  translate: (key: string, fallback: string) => string
  resourceKind: string
  resourceId: string
  parentResourceKind: string | null
  parentResourceId: string | null
  scope: Partial<Scope>
}) {
  return {
    actionLabel: args.translate(args.label[0], args.label[1]),
    resourceKind: args.resourceKind,
    resourceId: args.resourceId,
    parentResourceKind: args.parentResourceKind,
    parentResourceId: args.parentResourceId,
    tenantId: args.scope.tenantId ?? null,
    organizationId: args.scope.organizationId ?? null,
  }
}

export type TimelineRestoreArgs<TEntity extends object, TSnapshot> = {
  em: EntityManager
  dataEngine: DataEngine
  entityClass: new () => TEntity
  snapshot: TSnapshot
  /** Identity/scope fields read back out of the snapshot for the emitted side effect. */
  identifiers: { id: string; tenantId: string; organizationId: string }
  /**
   * Relation values (parent entity, linked deal, …), resolved by the caller before the
   * write so an out-of-scope reference fails before the row is touched.
   */
  relations?: Record<string, unknown>
  /** Seed for `em.create` when the row is gone (delete-undo). */
  seedFromSnapshot: (snapshot: TSnapshot) => Record<string, unknown>
  /** Field assignment applied whether the row was found or freshly created. */
  assignFromSnapshot: (entity: TEntity, snapshot: TSnapshot) => void
  /** `'updated'` for update-undo, `'created'` for delete-undo. */
  action: 'updated' | 'created'
  /**
   * Which emitter announces the restore. Undo replays use the undo emitter (default);
   * a create *redo* re-announces the row as an ordinary creation, because downstream
   * consumers should treat a redone create like the create it repeats.
   */
  emitWith?: 'undo' | 'crud'
  /** Runs after the row is flushed — activities restore their custom-field values here. */
  afterRestore?: (entity: TEntity) => Promise<void> | void
  indexer: CrudIndexerConfig<TEntity>
  events: CrudEventsConfig
  findRow?: (args: { em: EntityManager; id: string; snapshot: TSnapshot }) => Promise<TEntity | null>
}

/**
 * Restores a timeline sub-resource (comment / activity / address / note) from a persisted
 * undo snapshot, then emits the undo side effects.
 *
 * `update.undo` and `delete.undo` are the same upsert differing only in the emitted action,
 * so both run through here. The snapshots being replayed already exist in customer
 * databases, so field names stay owned by the caller via `seedFromSnapshot` /
 * `assignFromSnapshot` rather than being normalized here.
 */
export async function restoreTimelineEntityFromSnapshot<TEntity extends object, TSnapshot>(
  args: TimelineRestoreArgs<TEntity, TSnapshot>,
): Promise<TEntity> {
  const { em, snapshot, identifiers, relations = {} } = args

  const found = args.findRow
    ? await args.findRow({ em, id: identifiers.id, snapshot })
    : await em.findOne(args.entityClass, { id: identifiers.id } as never)

  let entity = found
  if (!entity) {
    entity = em.create(args.entityClass, {
      ...args.seedFromSnapshot(snapshot),
      ...relations,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never) as TEntity
    em.persist(entity)
  } else {
    Object.assign(entity, relations)
  }

  args.assignFromSnapshot(entity, snapshot)
  await em.flush()

  if (args.afterRestore) await args.afterRestore(entity)

  const emitter = args.emitWith === 'crud' ? emitCrudSideEffects : emitCrudUndoSideEffects
  await emitter({
    dataEngine: args.dataEngine,
    action: args.action,
    entity,
    identifiers,
    indexer: args.indexer,
    events: args.events,
  })

  return entity
}

// ─────────────────────────────────────────────────────────────────────────────
// makeCommentCommandSet
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineCommentSetConfig<TEntity extends TimelineEntity, TSnapshot, TCreate, TUpdate> = {
  // ── data: frozen contracts. Command ids, labels, change keys and snapshot field names
  // are replayed from rows already in customer databases, so each module supplies them
  // verbatim.
  commandIds: { create: string; update: string; delete: string }
  resourceKind: string
  /** `[i18n key, English fallback]` per verb, passed straight to `translate`. */
  auditLabels: { create: readonly [string, string]; update: readonly [string, string]; delete: readonly [string, string] }
  changeKeys: readonly string[]
  messages: { notFound: string; idRequired: string }
  entityClass: new () => TEntity
  indexer: CrudIndexerConfig<TEntity>
  events: CrudEventsConfig
  schemas: { create: { parse: (raw: unknown) => TCreate }; update: { parse: (raw: unknown) => TUpdate } }

  // ── policies
  /** Snapshot loader. `staff` applies a scope-aware `where` here (#3977). */
  loadSnapshot: (em: EntityManager, id: string, ctx: CommandRuntimeContext) => Promise<TSnapshot | null>
  seedFromSnapshot: (snapshot: TSnapshot) => Record<string, unknown>
  assignFromSnapshot: (entity: TEntity, snapshot: TSnapshot) => void
  /** Row lookup for update/delete. Apply tenant/org scope here when the module scopes reads (#3977). */
  findRowForWrite: (em: EntityManager, id: string, ctx: CommandRuntimeContext) => Promise<TEntity | null>
  /** Row lookup during undo/redo restore. Defaults to the write lookup's bare-id form. */
  findRowForRestore?: (args: { em: EntityManager; id: string; snapshot: TSnapshot }) => Promise<TEntity | null>
  /** Resolves the parent for a create, returning relation fields plus the parent's scope. */
  resolveParentForCreate: (args: { em: EntityManager; parsed: TCreate; ctx: CommandRuntimeContext }) => Promise<{ relations: Record<string, unknown>; scope: Scope }>
  /**
   * Resolves relation fields when replaying a snapshot. `kind` distinguishes the two
   * replay directions because they may fail differently: `sales` notes throw on a redo
   * whose document no longer resolves, but abort an undo silently by returning `null`.
   */
  resolveParentForRestore: (args: { em: EntityManager; snapshot: TSnapshot; kind: 'undo' | 'redo' }) => Promise<Record<string, unknown> | null>
  /**
   * Author for a create. Runs after the parent so a module may scope the lookup to it
   * (`resources` validates a delegated author against the resource's tenant/org).
   * Omit for entities without an author.
   */
  resolveAuthorForCreate?: (args: { em: EntityManager; parsed: TCreate; ctx: CommandRuntimeContext; parentScope: Scope }) => Promise<string | null> | string | null
  buildCreateData: (args: { parsed: TCreate; relations: Record<string, unknown>; authorUserId: string | null }) => Record<string, unknown>
  /** The module's own update field mapping, including any parent re-resolution. */
  applyUpdateFields: (args: { em: EntityManager; ctx: CommandRuntimeContext; entity: TEntity; parsed: TUpdate }) => Promise<void> | void
  /**
   * Parent/related log metadata. Both snapshots are passed because a module may take the
   * parent from `before` and the related resource from `after` — do not collapse to one.
   */
  logMeta: (snapshots: { before?: TSnapshot; after?: TSnapshot }) => {
    parentResourceKind: string | null
    parentResourceId: string | null
    relatedResourceKind?: string | null
    relatedResourceId?: string | null
  }
  buildResult: {
    create: (entity: TEntity) => unknown
    update: (entity: TEntity) => unknown
    delete: (entity: TEntity) => unknown
  }
  /**
   * Reads the row id back out of a handler result. Result shapes are module-owned
   * (`commentId`, `noteId`, …), so the factory cannot assume a key name.
   */
  resourceIdOf: (result: unknown) => string
  /** Scope assertions applied to a freshly loaded row, in each module's own idiom. */
  ensureRowInScope: (ctx: CommandRuntimeContext, entity: TEntity) => void
}

/**
 * Builds the `{ create, update, delete }` undoable command trio for a timeline
 * sub-resource.
 *
 * The algorithm is fixed: parse → scope → resolve parent → write → flush → emit side
 * effects, with `prepare`/`captureAfter` snapshots feeding a `buildLog` envelope and
 * undo/redo replaying those snapshots. Everything a module differs on is injected, so
 * each module keeps its own persisted contract byte for byte.
 */
export function makeCommentCommandSet<TEntity extends TimelineEntity, TSnapshot extends object, TCreate, TUpdate>(
  cfg: TimelineCommentSetConfig<TEntity, TSnapshot, TCreate, TUpdate>,
) {
  async function emit(ctx: CommandRuntimeContext, action: 'created' | 'updated' | 'deleted', entity: TEntity) {
    await emitCrudSideEffects({
      dataEngine: engine(ctx),
      action,
      entity,
      identifiers: idsOf(entity as unknown as Scope & { id: string }),
      indexer: cfg.indexer,
      events: cfg.events,
    })
  }

  function logEnvelope(
    label: readonly [string, string],
    translate: (key: string, fallback: string) => string,
    snapshots: { before?: TSnapshot; after?: TSnapshot },
    scopeSource: TSnapshot,
    resourceId: string,
  ) {
    const meta = cfg.logMeta(snapshots)
    return {
      ...timelineLogEnvelope({
        label,
        translate,
        resourceKind: cfg.resourceKind,
        resourceId,
        parentResourceKind: meta.parentResourceKind,
        parentResourceId: meta.parentResourceId,
        scope: scopeSource as unknown as Partial<Scope>,
      }),
      // Only the comment family carries a related resource, and only when the module
      // supplies one — an absent key must stay absent in the persisted row.
      ...(meta.relatedResourceKind !== undefined ? { relatedResourceKind: meta.relatedResourceKind } : {}),
      ...(meta.relatedResourceId !== undefined ? { relatedResourceId: meta.relatedResourceId } : {}),
    }
  }

  async function restore(ctx: CommandRuntimeContext, snapshot: TSnapshot, action: 'updated' | 'created') {
    const em = forkEm(ctx)
    const relations = await cfg.resolveParentForRestore({ em, snapshot, kind: 'undo' })
    if (relations === null) return
    await restoreTimelineEntityFromSnapshot<TEntity, TSnapshot>({
      em,
      dataEngine: engine(ctx),
      entityClass: cfg.entityClass,
      snapshot,
      identifiers: idsOf(snapshot as unknown as Scope & { id: string }),
      relations,
      action,
      indexer: cfg.indexer,
      events: cfg.events,
      findRow: cfg.findRowForRestore,
      seedFromSnapshot: cfg.seedFromSnapshot,
      assignFromSnapshot: cfg.assignFromSnapshot,
    })
  }

  const create: CommandHandler<TCreate, unknown> = {
    id: cfg.commandIds.create,
    async execute(rawInput, ctx) {
      const parsed = cfg.schemas.create.parse(rawInput)
      const em = forkEm(ctx)
      const { relations, scope } = await cfg.resolveParentForCreate({ em, parsed, ctx })
      const authorUserId = cfg.resolveAuthorForCreate
        ? await cfg.resolveAuthorForCreate({ em, parsed, ctx, parentScope: scope })
        : null
      const entity = em.create(cfg.entityClass, {
        ...cfg.buildCreateData({ parsed, relations, authorUserId }),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never) as TEntity
      em.persist(entity)
      await em.flush()
      await emit(ctx, 'created', entity)
      return cfg.buildResult.create(entity)
    },
    captureAfter: async (_input, result, ctx) => cfg.loadSnapshot(forkEm(ctx), cfg.resourceIdOf(result), ctx),
    buildLog: async ({ result, snapshots }) => {
      const { translate } = await resolveTranslations()
      const snapshot = snapshots.after as TSnapshot | undefined
      const resourceId = cfg.resourceIdOf(result)
      if (!snapshot) return null
      return {
        ...logEnvelope(cfg.auditLabels.create, translate, { after: snapshot }, snapshot, resourceId),
        snapshotAfter: snapshot,
        payload: { undo: { after: snapshot } },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const id = logEntry?.resourceId ?? null
      if (!id) return
      const em = forkEm(ctx)
      const existing = await em.findOne(cfg.entityClass, { id } as never)
      if (existing) {
        em.remove(existing)
        await em.flush()
      }
    },
    redo: makeCreateRedo<TEntity, TSnapshot & Scope, TCreate, unknown>({
      entityClass: cfg.entityClass,
      indexer: cfg.indexer,
      events: cfg.events,
      findRow: cfg.findRowForRestore
        ? ({ em, id, snapshot }) => cfg.findRowForRestore!({ em, id, snapshot })
        : undefined,
      seedFromSnapshot: cfg.seedFromSnapshot,
      beforeRestore: async ({ em, snapshot }: { em: EntityManager; snapshot: TSnapshot & Scope }) =>
        (await cfg.resolveParentForRestore({ em, snapshot, kind: 'redo' })) ?? {},
      buildResult: (entity: TEntity) => cfg.buildResult.create(entity),
    }),
  }

  const update: CommandHandler<TUpdate, unknown> = {
    id: cfg.commandIds.update,
    async prepare(rawInput, ctx) {
      const parsed = cfg.schemas.update.parse(rawInput)
      const snapshot = await cfg.loadSnapshot(rawEm(ctx), (parsed as { id: string }).id, ctx)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(rawInput, ctx) {
      const parsed = cfg.schemas.update.parse(rawInput)
      const em = forkEm(ctx)
      const entity = await cfg.findRowForWrite(em, (parsed as { id: string }).id, ctx)
      if (!entity) throw notFound(cfg.messages.notFound)
      cfg.ensureRowInScope(ctx, entity)
      await cfg.applyUpdateFields({ em, ctx, entity, parsed })
      await em.flush()
      await emit(ctx, 'updated', entity)
      return cfg.buildResult.update(entity)
    },
    captureAfter: async (_input, result, ctx) => cfg.loadSnapshot(forkEm(ctx), cfg.resourceIdOf(result), ctx),
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as TSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      const after = snapshots.after as TSnapshot | undefined
      const changes = after
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            after as unknown as Record<string, unknown>,
            cfg.changeKeys as string[],
          )
        : {}
      return {
        ...logEnvelope(cfg.auditLabels.update, translate, { before, after }, before, (before as unknown as { id: string }).id),
        snapshotBefore: before,
        snapshotAfter: after ?? null,
        changes,
        payload: { undo: { before, after: after ?? null } },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const before = extractUndoPayload<{ before?: TSnapshot | null }>(logEntry)?.before
      if (!before) return
      await restore(ctx, before, 'updated')
    },
  }

  const del: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, unknown> = {
    id: cfg.commandIds.delete,
    async prepare(input, ctx) {
      const id = requireId(input, cfg.messages.idRequired)
      const snapshot = await cfg.loadSnapshot(rawEm(ctx), id, ctx)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, cfg.messages.idRequired)
      const em = forkEm(ctx)
      const entity = await cfg.findRowForWrite(em, id, ctx)
      if (!entity) throw notFound(cfg.messages.notFound)
      cfg.ensureRowInScope(ctx, entity)
      em.remove(entity)
      await em.flush()
      await emit(ctx, 'deleted', entity)
      return cfg.buildResult.delete(entity)
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as TSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        ...logEnvelope(cfg.auditLabels.delete, translate, { before }, before, (before as unknown as { id: string }).id),
        snapshotBefore: before,
        payload: { undo: { before } },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const before = extractUndoPayload<{ before?: TSnapshot | null }>(logEntry)?.before
      if (!before) return
      await restore(ctx, before, 'created')
    },
  }

  return { create, update, delete: del }
}

// ─────────────────────────────────────────────────────────────────────────────
// makeActivityCommandSet
//
// A separate contract from `makeCommentCommandSet`, not a superset: activities persist a
// nested `{ activity, custom? }` snapshot and carry custom fields through every write and
// restore path. The two configs are not interchangeable.
// ─────────────────────────────────────────────────────────────────────────────

/** The nested envelope activities already persist in `action_logs`. */
export type ActivitySnapshotEnvelope<TRow> = { activity: TRow; custom?: Record<string, unknown> }

export type TimelineActivitySetConfig<TEntity extends TimelineEntity, TRow extends Scope & { id: string }, TCreate, TUpdate> = {
  // ── data: frozen contracts
  commandIds: { create: string; update: string; delete: string }
  resourceKind: string
  /** Constant per module; activities never derive it per row. */
  parentResourceKind: string
  auditLabels: { create: readonly [string, string]; update: readonly [string, string]; delete: readonly [string, string] }
  changeKeys: readonly string[]
  messages: { notFound: string; idRequired: string; redoUnavailable: string }
  entityClass: new () => TEntity
  indexer: CrudIndexerConfig<TEntity>
  events: CrudEventsConfig
  /**
   * Zod schemas, not the structural `{ parse }` the other two factories take:
   * `parseWithCustomFields` splits `cf_*` keys off the payload before parsing.
   */
  schemas: { create: z.ZodType<TCreate>; update: z.ZodType<TUpdate> }
  /** Entity id used for custom-field snapshot/restore. */
  customFieldEntityId: string

  // ── policies
  loadSnapshot: (em: EntityManager, id: string, ctx: CommandRuntimeContext) => Promise<ActivitySnapshotEnvelope<TRow> | null>
  findRowForWrite: (em: EntityManager, id: string, ctx: CommandRuntimeContext) => Promise<TEntity | null>
  findRowForRestore: (args: { em: EntityManager; id: string; row: TRow }) => Promise<TEntity | null>
  resolveParentForCreate: (args: { em: EntityManager; parsed: TCreate; ctx: CommandRuntimeContext }) => Promise<{ relations: Record<string, unknown>; scope: Scope }>
  resolveParentForRestore: (args: { em: EntityManager; row: TRow }) => Promise<Record<string, unknown>>
  resolveAuthorForCreate?: (args: { em: EntityManager; parsed: TCreate; ctx: CommandRuntimeContext; parentScope: Scope }) => Promise<string | null> | string | null
  buildCreateData: (args: { parsed: TCreate; relations: Record<string, unknown>; authorUserId: string | null }) => Record<string, unknown>
  /** The module's own update field mapping, including any parent re-resolution. */
  applyUpdateFields: (args: { em: EntityManager; ctx: CommandRuntimeContext; entity: TEntity; parsed: TUpdate }) => Promise<void> | void
  seedFromSnapshot: (row: TRow) => Record<string, unknown>
  assignFromSnapshot: (entity: TEntity, row: TRow) => void
  /** Parent id for log metadata, read out of the module's own row shape. */
  parentIdOf: (row: TRow) => string | null
  ensureRowInScope: (ctx: CommandRuntimeContext, entity: TEntity) => void
  buildResult: {
    create: (entity: TEntity) => unknown
    update: (entity: TEntity) => unknown
    delete: (entity: TEntity) => unknown
  }
  /** Row id a create-undo removes: the log entry's resource id, or the snapshot's own. */
  createUndoTargetId: (args: { logEntryResourceId: string | null; after?: ActivitySnapshotEnvelope<TRow> | null }) => string | null
  /**
   * Custom-field values to write when replaying a snapshot. `kind` is supplied because
   * undo and redo need different values and modules rebuild them differently.
   * Returning `{}` writes nothing.
   */
  customFieldRestoreValues: (args: {
    kind: 'update-undo' | 'delete-undo' | 'create-redo'
    before?: ActivitySnapshotEnvelope<TRow> | null
    after?: ActivitySnapshotEnvelope<TRow> | null
  }) => Record<string, unknown>
}

/**
 * Builds the `{ create, update, delete }` undoable trio for an activity timeline
 * sub-resource.
 *
 * Beyond the comment algorithm this owns the custom-field lifecycle: `parseWithCustomFields`
 * splits them off the request, `setCustomFieldsIfAny` re-applies them after every write and
 * restore, and `diffCustomFieldChanges` contributes a `custom` entry to the audit `changes`
 * only when values actually differ.
 */
export function makeActivityCommandSet<
  TEntity extends TimelineEntity,
  TRow extends Scope & { id: string },
  TCreate,
  TUpdate,
>(cfg: TimelineActivitySetConfig<TEntity, TRow, TCreate, TUpdate>) {
  type Envelope = ActivitySnapshotEnvelope<TRow>

  /** Both activity modules return `{ activityId }`; the key is part of their route contract. */
  const resourceIdOf = (result: unknown) => (result as { activityId: string }).activityId
  const entityIds = (entity: TEntity) => idsOf(entity as unknown as Scope & { id: string })

  async function applyCustomFields(ctx: CommandRuntimeContext, entity: TEntity, values: Record<string, unknown>) {
    if (!values || !Object.keys(values).length) return
    const ids = entityIds(entity)
    await setCustomFieldsIfAny({
      dataEngine: engine(ctx),
      entityId: cfg.customFieldEntityId,
      recordId: ids.id,
      organizationId: ids.organizationId,
      tenantId: ids.tenantId,
      values,
      notify: false,
    })
  }

  async function emit(ctx: CommandRuntimeContext, action: 'created' | 'updated' | 'deleted', entity: TEntity) {
    await emitCrudSideEffects({
      dataEngine: engine(ctx),
      action,
      entity,
      identifiers: entityIds(entity),
      indexer: cfg.indexer,
      events: cfg.events,
    })
  }

  const logEnvelope = (
    label: readonly [string, string],
    translate: (key: string, fallback: string) => string,
    row: TRow,
    resourceId: string,
  ) =>
    timelineLogEnvelope({
      label,
      translate,
      resourceKind: cfg.resourceKind,
      resourceId,
      parentResourceKind: cfg.parentResourceKind,
      parentResourceId: cfg.parentIdOf(row),
      scope: row,
    })

  async function restore(args: {
    ctx: CommandRuntimeContext
    snapshot: Envelope
    action: 'updated' | 'created'
    emitWith: 'undo' | 'crud'
    kind: 'update-undo' | 'delete-undo' | 'create-redo'
    before?: Envelope | null
    after?: Envelope | null
  }) {
    const { ctx, snapshot, action, emitWith } = args
    const em = forkEm(ctx)
    const relations = await cfg.resolveParentForRestore({ em, row: snapshot.activity })
    const entity = await restoreTimelineEntityFromSnapshot<TEntity, TRow>({
      em,
      dataEngine: engine(ctx),
      entityClass: cfg.entityClass,
      snapshot: snapshot.activity,
      identifiers: {
        id: snapshot.activity.id,
        organizationId: snapshot.activity.organizationId,
        tenantId: snapshot.activity.tenantId,
      },
      relations,
      action,
      emitWith,
      indexer: cfg.indexer,
      events: cfg.events,
      findRow: ({ em: restoreEm, id, snapshot: row }) => cfg.findRowForRestore({ em: restoreEm, id, row }),
      seedFromSnapshot: cfg.seedFromSnapshot,
      assignFromSnapshot: cfg.assignFromSnapshot,
      afterRestore: (restored) =>
        applyCustomFields(ctx, restored, cfg.customFieldRestoreValues({ kind: args.kind, before: args.before, after: args.after })),
    })
    return entity
  }

  const create: CommandHandler<TCreate, unknown> = {
    id: cfg.commandIds.create,
    async execute(rawInput, ctx) {
      const { parsed, custom } = parseWithCustomFields(cfg.schemas.create, rawInput)
      const em = forkEm(ctx)
      const { relations, scope } = await cfg.resolveParentForCreate({ em, parsed, ctx })
      const authorUserId = cfg.resolveAuthorForCreate
        ? await cfg.resolveAuthorForCreate({ em, parsed, ctx, parentScope: scope })
        : null
      const entity = em.create(cfg.entityClass, {
        ...cfg.buildCreateData({ parsed, relations, authorUserId }),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never) as TEntity
      em.persist(entity)
      await em.flush()
      await applyCustomFields(ctx, entity, custom)
      await emit(ctx, 'created', entity)
      return cfg.buildResult.create(entity)
    },
    captureAfter: async (_input, result, ctx) =>
      cfg.loadSnapshot(forkEm(ctx), resourceIdOf(result), ctx),
    buildLog: async ({ result, snapshots }) => {
      const { translate } = await resolveTranslations()
      const after = snapshots.after as Envelope | undefined
      const resourceId = resourceIdOf(result)
      if (!after) return null
      return {
        ...logEnvelope(cfg.auditLabels.create, translate, after.activity, resourceId),
        snapshotAfter: after,
        payload: { undo: { after } },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const after = extractUndoPayload<{ after?: Envelope | null }>(logEntry)?.after
      const id = cfg.createUndoTargetId({ logEntryResourceId: logEntry?.resourceId ?? null, after })
      if (!id) return
      const em = forkEm(ctx)
      const existing = after
        ? await cfg.findRowForRestore({ em, id, row: after.activity })
        : await em.findOne(cfg.entityClass, { id } as never)
      if (existing) {
        em.remove(existing)
        await em.flush()
      }
    },
    // Not `makeCreateRedo`: custom-field values must be re-applied after the row is
    // restored, and the redo is announced as an ordinary creation, not as an undo.
    redo: async ({ logEntry, ctx }) => {
      const after = resolveRedoSnapshot<Envelope>(logEntry)
      if (!after) throw new CrudHttpError(400, { error: cfg.messages.redoUnavailable })
      const entity = await restore({ ctx, snapshot: after, action: 'created', emitWith: 'crud', kind: 'create-redo', after })
      return cfg.buildResult.create(entity)
    },
  }

  const update: CommandHandler<TUpdate, unknown> = {
    id: cfg.commandIds.update,
    async prepare(rawInput, ctx) {
      const { parsed } = parseWithCustomFields(cfg.schemas.update, rawInput)
      const snapshot = await cfg.loadSnapshot(rawEm(ctx), (parsed as { id: string }).id, ctx)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(rawInput, ctx) {
      const { parsed, custom } = parseWithCustomFields(cfg.schemas.update, rawInput)
      const em = forkEm(ctx)
      const entity = await cfg.findRowForWrite(em, (parsed as { id: string }).id, ctx)
      if (!entity) throw notFound(cfg.messages.notFound)
      cfg.ensureRowInScope(ctx, entity)
      await cfg.applyUpdateFields({ em, ctx, entity, parsed })
      await em.flush()
      await applyCustomFields(ctx, entity, custom)
      await emit(ctx, 'updated', entity)
      return cfg.buildResult.update(entity)
    },
    captureAfter: async (_input, result, ctx) =>
      cfg.loadSnapshot(forkEm(ctx), resourceIdOf(result), ctx),
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as Envelope | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      const after = snapshots.after as Envelope | undefined
      const changes: Record<string, unknown> = after
        ? buildChanges(
            before.activity as unknown as Record<string, unknown>,
            after.activity as unknown as Record<string, unknown>,
            cfg.changeKeys as string[],
          )
        : {}
      const customChanges = diffCustomFieldChanges(before.custom, after?.custom)
      if (Object.keys(customChanges).length) changes.custom = customChanges
      return {
        ...logEnvelope(cfg.auditLabels.update, translate, before.activity, before.activity.id),
        snapshotBefore: before,
        snapshotAfter: after ?? null,
        changes,
        payload: { undo: { before, after: after ?? null } },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const payload = extractUndoPayload<{ before?: Envelope | null; after?: Envelope | null }>(logEntry)
      const before = payload?.before
      if (!before) return
      await restore({ ctx, snapshot: before, action: 'updated', emitWith: 'undo', kind: 'update-undo', before, after: payload?.after })
    },
  }

  const del: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, unknown> = {
    id: cfg.commandIds.delete,
    async prepare(input, ctx) {
      const id = requireId(input, cfg.messages.idRequired)
      const snapshot = await cfg.loadSnapshot(rawEm(ctx), id, ctx)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, cfg.messages.idRequired)
      const em = forkEm(ctx)
      const entity = await cfg.findRowForWrite(em, id, ctx)
      if (!entity) throw notFound(cfg.messages.notFound)
      cfg.ensureRowInScope(ctx, entity)
      em.remove(entity)
      await em.flush()
      await emit(ctx, 'deleted', entity)
      return cfg.buildResult.delete(entity)
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as Envelope | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        ...logEnvelope(cfg.auditLabels.delete, translate, before.activity, before.activity.id),
        snapshotBefore: before,
        payload: { undo: { before } },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const before = extractUndoPayload<{ before?: Envelope | null }>(logEntry)?.before
      if (!before) return
      await restore({ ctx, snapshot: before, action: 'created', emitWith: 'undo', kind: 'delete-undo', before })
    },
  }

  return { create, update, delete: del }
}

// ─────────────────────────────────────────────────────────────────────────────
// makeAddressCommandSet
//
// Addresses have no author and no custom fields, but add the primary-address invariant:
// at most one address per parent may be primary, re-established after every write that
// can leave the row primary.
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineAddressSetConfig<TEntity extends TimelineEntity, TSnapshot extends Scope & { id: string; isPrimary: boolean }, TCreate, TUpdate> = {
  // ── data: frozen contracts
  commandIds: { create: string; update: string; delete: string }
  resourceKind: string
  auditLabels: { create: readonly [string, string]; update: readonly [string, string]; delete: readonly [string, string] }
  changeKeys: readonly string[]
  messages: { notFound: string; idRequired: string; redoUnavailable: string }
  entityClass: new () => TEntity
  indexer: CrudIndexerConfig<TEntity>
  events: CrudEventsConfig
  schemas: { create: { parse: (raw: unknown) => TCreate }; update: { parse: (raw: unknown) => TUpdate } }
  /**
   * Whether the row write and the primary-address demotion commit together, inside
   * `withAtomicFlush(..., { transaction: true })`.
   *
   * `false` means a failure between the two can leave a parent holding two primary
   * addresses. The flag keeps that difference visible rather than silent; remove it once
   * every module is transactional.
   */
  atomicWrites: boolean

  // ── policies
  loadSnapshot: (em: EntityManager, id: string, ctx: CommandRuntimeContext) => Promise<TSnapshot | null>
  findRowForWrite: (em: EntityManager, id: string, ctx: CommandRuntimeContext) => Promise<TEntity | null>
  findRowForRestore?: (args: { em: EntityManager; id: string; snapshot: TSnapshot }) => Promise<TEntity | null>
  resolveParentForCreate: (args: { em: EntityManager; parsed: TCreate; ctx: CommandRuntimeContext }) => Promise<{ relations: Record<string, unknown>; parentId: string }>
  resolveParentForRestore: (args: { em: EntityManager; snapshot: TSnapshot }) => Promise<{ relations: Record<string, unknown>; parentId: string }>
  buildCreateData: (args: { parsed: TCreate; relations: Record<string, unknown> }) => Record<string, unknown>
  applyUpdateFields: (args: { em: EntityManager; ctx: CommandRuntimeContext; entity: TEntity; parsed: TUpdate }) => Promise<void> | void
  seedFromSnapshot: (snapshot: TSnapshot) => Record<string, unknown>
  assignFromSnapshot: (entity: TEntity, snapshot: TSnapshot) => void
  /** Parent id of a live row, for the primary-address demotion after an update. */
  primaryParentIdOfEntity: (entity: TEntity) => string
  /** Demotes every other primary address of the same parent. */
  enforcePrimary: (em: EntityManager, parentId: string, addressId: string) => Promise<void>
  logMeta: (snapshot: TSnapshot) => { parentResourceKind: string | null; parentResourceId: string | null }
  ensureRowInScope: (ctx: CommandRuntimeContext, entity: TEntity) => void
  buildResult: {
    create: (entity: TEntity) => unknown
    update: (entity: TEntity) => unknown
    delete: (entity: TEntity) => unknown
  }
  /** Row id a create-undo removes: the log entry's resource id, or the snapshot's own. */
  createUndoTargetId: (args: { logEntryResourceId: string | null; after?: TSnapshot | null }) => string | null
}

/**
 * Builds the `{ create, update, delete }` undoable trio for an address timeline
 * sub-resource.
 *
 * The address-specific part is the primary-address invariant: after any write that
 * leaves the row primary, every sibling primary must be demoted. That happens on five
 * paths — create, create-redo, update, update-undo and delete-undo — always guarded by
 * the row's own `isPrimary`, and always inside the module's configured write strategy.
 */
export function makeAddressCommandSet<
  TEntity extends TimelineEntity,
  TSnapshot extends Scope & { id: string; isPrimary: boolean },
  TCreate,
  TUpdate,
>(cfg: TimelineAddressSetConfig<TEntity, TSnapshot, TCreate, TUpdate>) {
  /** Both address modules return `{ addressId }`; the key is part of their route contract. */
  const resourceIdOf = (result: unknown) => (result as { addressId: string }).addressId
  const entityIds = (entity: TEntity) => idsOf(entity as unknown as Scope & { id: string })

  /** Commits a write and, when the row is primary, demotes its siblings. See `atomicWrites`. */
  async function commitWithPrimary(em: EntityManager, entity: TEntity, parentId: string, isPrimary: boolean) {
    const work = async () => {
      em.persist(entity)
      await em.flush()
      if (isPrimary) {
        await cfg.enforcePrimary(em, parentId, (entity as unknown as { id: string }).id)
        if (!cfg.atomicWrites) await em.flush()
      }
    }
    if (cfg.atomicWrites) await withAtomicFlush(em, [work], { transaction: true })
    else await work()
  }

  async function emit(ctx: CommandRuntimeContext, action: 'created' | 'updated' | 'deleted', entity: TEntity, undoEmitter = false) {
    const emitter = undoEmitter ? emitCrudUndoSideEffects : emitCrudSideEffects
    await emitter({
      dataEngine: engine(ctx),
      action,
      entity,
      identifiers: entityIds(entity),
      indexer: cfg.indexer,
      events: cfg.events,
    })
  }

  const logEnvelope = (
    label: readonly [string, string],
    translate: (key: string, fallback: string) => string,
    snapshot: TSnapshot,
    resourceId: string,
  ) =>
    timelineLogEnvelope({
      label,
      translate,
      resourceKind: cfg.resourceKind,
      resourceId,
      ...cfg.logMeta(snapshot),
      scope: snapshot,
    })

  /** Shared by create-redo, update-undo and delete-undo. */
  async function restore(ctx: CommandRuntimeContext, snapshot: TSnapshot, action: 'updated' | 'created', undoEmitter: boolean) {
    const em = forkEm(ctx)
    const { relations, parentId } = await cfg.resolveParentForRestore({ em, snapshot })
    const found = cfg.findRowForRestore
      ? await cfg.findRowForRestore({ em, id: snapshot.id, snapshot })
      : await em.findOne(cfg.entityClass, { id: snapshot.id } as never)

    let entity = found
    if (!entity) {
      entity = em.create(cfg.entityClass, {
        ...cfg.seedFromSnapshot(snapshot),
        ...relations,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never) as TEntity
      em.persist(entity)
    } else {
      Object.assign(entity, relations)
    }
    cfg.assignFromSnapshot(entity, snapshot)

    await commitWithPrimary(em, entity, parentId, snapshot.isPrimary)
    await emit(ctx, action, entity, undoEmitter)
    return entity
  }

  const create: CommandHandler<TCreate, unknown> = {
    id: cfg.commandIds.create,
    async execute(rawInput, ctx) {
      const parsed = cfg.schemas.create.parse(rawInput)
      const em = forkEm(ctx)
      const { relations, parentId } = await cfg.resolveParentForCreate({ em, parsed, ctx })
      const entity = em.create(cfg.entityClass, {
        ...cfg.buildCreateData({ parsed, relations }),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never) as TEntity
      await commitWithPrimary(em, entity, parentId, Boolean((entity as unknown as { isPrimary?: boolean }).isPrimary))
      await emit(ctx, 'created', entity)
      return cfg.buildResult.create(entity)
    },
    captureAfter: async (_input, result, ctx) =>
      cfg.loadSnapshot(forkEm(ctx), resourceIdOf(result), ctx),
    buildLog: async ({ result, snapshots }) => {
      const { translate } = await resolveTranslations()
      const after = snapshots.after as TSnapshot | undefined
      if (!after) return null
      return {
        ...logEnvelope(cfg.auditLabels.create, translate, after, resourceIdOf(result)),
        snapshotAfter: after,
        payload: { undo: { after } },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const after = extractUndoPayload<{ after?: TSnapshot | null }>(logEntry)?.after
      const id = cfg.createUndoTargetId({ logEntryResourceId: logEntry?.resourceId ?? null, after })
      if (!id) return
      const em = forkEm(ctx)
      const existing = after && cfg.findRowForRestore
        ? await cfg.findRowForRestore({ em, id, snapshot: after })
        : await em.findOne(cfg.entityClass, { id } as never)
      if (existing) {
        em.remove(existing)
        await em.flush()
      }
    },
    redo: async ({ logEntry, ctx }) => {
      const after = resolveRedoSnapshot<TSnapshot>(logEntry)
      if (!after) throw new CrudHttpError(400, { error: cfg.messages.redoUnavailable })
      const entity = await restore(ctx, after, 'created', false)
      return cfg.buildResult.create(entity)
    },
  }

  const update: CommandHandler<TUpdate, unknown> = {
    id: cfg.commandIds.update,
    async prepare(rawInput, ctx) {
      const parsed = cfg.schemas.update.parse(rawInput)
      const snapshot = await cfg.loadSnapshot(rawEm(ctx), (parsed as { id: string }).id, ctx)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(rawInput, ctx) {
      const parsed = cfg.schemas.update.parse(rawInput)
      const em = forkEm(ctx)
      const entity = await cfg.findRowForWrite(em, (parsed as { id: string }).id, ctx)
      if (!entity) throw notFound(cfg.messages.notFound)
      cfg.ensureRowInScope(ctx, entity)
      await cfg.applyUpdateFields({ em, ctx, entity, parsed })
      await commitWithPrimary(
        em,
        entity,
        cfg.primaryParentIdOfEntity(entity),
        Boolean((entity as unknown as { isPrimary?: boolean }).isPrimary),
      )
      await emit(ctx, 'updated', entity)
      return cfg.buildResult.update(entity)
    },
    captureAfter: async (_input, result, ctx) =>
      cfg.loadSnapshot(forkEm(ctx), resourceIdOf(result), ctx),
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as TSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      const after = snapshots.after as TSnapshot | undefined
      const changes = after
        ? buildChanges(
            before as unknown as Record<string, unknown>,
            after as unknown as Record<string, unknown>,
            cfg.changeKeys as string[],
          )
        : {}
      return {
        ...logEnvelope(cfg.auditLabels.update, translate, before, before.id),
        snapshotBefore: before,
        snapshotAfter: after ?? null,
        changes,
        payload: { undo: { before, after: after ?? null } },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const before = extractUndoPayload<{ before?: TSnapshot | null }>(logEntry)?.before
      if (!before) return
      await restore(ctx, before, 'updated', true)
    },
  }

  const del: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, unknown> = {
    id: cfg.commandIds.delete,
    async prepare(input, ctx) {
      const id = requireId(input, cfg.messages.idRequired)
      const snapshot = await cfg.loadSnapshot(rawEm(ctx), id, ctx)
      return snapshot ? { before: snapshot } : {}
    },
    async execute(input, ctx) {
      const id = requireId(input, cfg.messages.idRequired)
      const em = forkEm(ctx)
      const entity = await cfg.findRowForWrite(em, id, ctx)
      if (!entity) throw notFound(cfg.messages.notFound)
      cfg.ensureRowInScope(ctx, entity)
      em.remove(entity)
      await em.flush()
      await emit(ctx, 'deleted', entity)
      return cfg.buildResult.delete(entity)
    },
    buildLog: async ({ snapshots }) => {
      const before = snapshots.before as TSnapshot | undefined
      if (!before) return null
      const { translate } = await resolveTranslations()
      return {
        ...logEnvelope(cfg.auditLabels.delete, translate, before, before.id),
        snapshotBefore: before,
        payload: { undo: { before } },
      }
    },
    undo: async ({ logEntry, ctx }) => {
      const before = extractUndoPayload<{ before?: TSnapshot | null }>(logEntry)?.before
      if (!before) return
      await restore(ctx, before, 'created', true)
    },
  }

  return { create, update, delete: del }
}
