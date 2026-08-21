import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext, CommandUndoLogEntry } from './types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { CrudHttpError, conflict, isUniqueViolation } from '@open-mercato/shared/lib/crud/errors'
import { extractUndoPayload, type UndoPayload } from './undo'
import { emitCrudSideEffects } from './helpers'
import { withAtomicFlush } from './flush'

type EntityClass<T> = abstract new (...args: never[]) => T

type ScopedSoftDeletable = {
  id: string
  organizationId?: string | null
  tenantId?: string | null
  deletedAt?: Date | null
  isActive?: boolean
}

/** Snapshot keys revived from ISO strings to `Date` when no explicit `dateFields` is given. */
const DEFAULT_SNAPSHOT_DATE_FIELDS = ['createdAt', 'updatedAt', 'deletedAt'] as const

/**
 * Turn an after-snapshot into a create seed by shallow-cloning it and reviving the
 * declared date fields from ISO strings back to `Date`. Single-row snapshots are a
 * faithful serialized row whose keys already equal entity property names, so the
 * snapshot doubles as the seed once dates are revived — no per-command mapping needed.
 */
export function reviveSnapshotSeed(
  snapshot: Record<string, unknown>,
  dateFields: readonly string[] = DEFAULT_SNAPSHOT_DATE_FIELDS,
): Record<string, unknown> {
  const seed: Record<string, unknown> = { ...snapshot }
  for (const field of dateFields) {
    const value = seed[field]
    if (typeof value === 'string') seed[field] = new Date(value)
  }
  return seed
}

/**
 * Serialize a persisted row into a plain after-snapshot object: pick `fields` from
 * the entity and convert the declared `dateFields` from `Date` to ISO strings. Use
 * for single-row snapshot loaders that are a clean 1:1 column copy; loaders that
 * shape nested/related data keep their bespoke mapping.
 */
export function serializeRowSnapshot<TEntity extends Record<string, unknown>>(
  entity: TEntity,
  fields: readonly string[],
  dateFields: readonly string[] = DEFAULT_SNAPSHOT_DATE_FIELDS,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  const dateFieldSet = new Set(dateFields)
  for (const field of fields) {
    const value = entity[field]
    if (dateFieldSet.has(field)) {
      snapshot[field] = value instanceof Date ? value.toISOString() : (value ?? null)
    } else {
      snapshot[field] = value ?? null
    }
  }
  return snapshot
}

/**
 * Resolve the after-snapshot a create command persisted for its action log, so a
 * `redo` handler can re-materialize the original record. Reads the `undo.after`
 * snapshot via {@link extractUndoPayload} and falls back to `snapshotAfter`.
 */
export function resolveRedoSnapshot<T>(logEntry: CommandUndoLogEntry | null | undefined): T | null {
  if (!logEntry) return null
  const undo = extractUndoPayload<UndoPayload<T>>(logEntry)
  if (undo && undo.after != null) return undo.after as T
  if (logEntry.snapshotAfter != null) return logEntry.snapshotAfter as T
  return null
}

/**
 * Re-materialize a single row that a create command produced, reusing its original
 * id. If the row still exists (it was soft-deleted by undo), clears `deletedAt` and
 * restores `isActive` from the seed. If it was hard-deleted, re-creates it from the
 * seed (which MUST include the original `id`). This keeps redo idempotent on id so
 * undo/redo snapshots and cross-references stay stable (issue #2506, invariant I6).
 */
export async function restoreCreatedRow<TEntity extends ScopedSoftDeletable>(
  em: EntityManager,
  entityClass: EntityClass<TEntity>,
  id: string,
  seedFromSnapshot: () => Record<string, unknown>,
  findRow?: (em: EntityManager, id: string) => Promise<TEntity | null>,
): Promise<TEntity> {
  const existing = findRow
    ? await findRow(em, id)
    : ((await em.findOne(entityClass as never, { id } as never)) as TEntity | null)
  if (existing) {
    existing.deletedAt = null
    const seed = seedFromSnapshot()
    if (typeof seed.isActive === 'boolean') existing.isActive = seed.isActive
    return existing
  }
  const record = em.create(entityClass as never, { ...seedFromSnapshot(), deletedAt: null } as never) as TEntity
  em.persist(record as never)
  return record
}

export type CreateRedoConfig<TEntity extends ScopedSoftDeletable, TSnapshot, TResult> = {
  entityClass: EntityClass<TEntity>
  /**
   * Pulls the original primary id out of the after-snapshot. Defaults to
   * `(snapshot) => snapshot.id`, which fits single-row snapshots whose top-level
   * `id` is the row's primary key. Override only when the id lives elsewhere.
   */
  getSnapshotId?: (snapshot: TSnapshot) => string | null | undefined
  /**
   * Maps the after-snapshot back to a create seed; MUST include the original id.
   * Defaults to {@link reviveSnapshotSeed} — the snapshot itself with `dateFields`
   * revived to `Date`. Override only when the snapshot keys diverge from entity
   * columns (e.g. nested shapes or derived columns).
   */
  seedFromSnapshot?: (snapshot: TSnapshot) => Record<string, unknown>
  /**
   * Snapshot keys to revive from ISO string to `Date` for the default seed.
   * Defaults to `['createdAt', 'updatedAt', 'deletedAt']`; list additional date
   * columns (e.g. `effectiveAt`, `returnedAt`) when the entity has them.
   */
  dateFields?: readonly string[]
  /** Builds the command result (mirrors `execute`'s return), e.g. `(e) => ({ currencyId: e.id })`. */
  buildResult: (entity: TEntity, snapshot: TSnapshot) => TResult
  events?: CrudEventsConfig<any>
  indexer?: CrudIndexerConfig<any>
  /**
   * Override how the existing row is looked up before restore. Defaults to
   * `em.findOne(entityClass, { id })`. Pass a decryption-aware finder
   * (`findOneWithDecryption`) for encrypted entities so the revive-in-place path
   * sees the same row the rest of the module does.
   */
  findRow?: (args: { em: EntityManager; ctx: CommandRuntimeContext; id: string; snapshot: TSnapshot }) => Promise<TEntity | null>
  /**
   * Runs after the em fork, before the row is restored. Use to validate
   * referenced relations (throw `CrudHttpError` to fail the redo) or resolve
   * relation entities. Anything it returns is shallow-merged into the create
   * seed (e.g. `{ entity: resolvedEntity }`), letting the seed reference a live
   * relation instead of a raw id.
   */
  beforeRestore?: (args: {
    em: EntityManager
    ctx: CommandRuntimeContext
    snapshot: TSnapshot
  }) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
  /** Optional extra side effects after the row is restored (e.g. query-index upserts, custom-field restore). */
  afterRestore?: (args: {
    em: EntityManager
    ctx: CommandRuntimeContext
    entity: TEntity
    snapshot: TSnapshot
    logEntry: CommandUndoLogEntry
  }) => Promise<void> | void
  /**
   * Wrap the restore (create/revive + flush) in a single transaction via
   * {@link withAtomicFlush}. Use when the create participated in a multi-phase
   * atomic flush in `execute` and partial commits must be impossible.
   */
  transaction?: boolean
}

/**
 * Build a create command's `redo` handler that restores the original row in place
 * (reusing its id) instead of replaying `execute` and minting a new id. Wires the
 * `created` side effects (events + query index) exactly like `execute`. Use this for
 * single-row create commands; multi-entity creates implement `redo` by hand.
 */
export function makeCreateRedo<
  TEntity extends ScopedSoftDeletable,
  TSnapshot,
  TInput = unknown,
  TResult = unknown,
>(config: CreateRedoConfig<TEntity, TSnapshot, TResult>) {
  const getSnapshotId = config.getSnapshotId ?? ((snapshot: TSnapshot) => (snapshot as { id?: string | null }).id ?? null)
  const seedFromSnapshot =
    config.seedFromSnapshot ?? ((snapshot: TSnapshot) => reviveSnapshotSeed(snapshot as Record<string, unknown>, config.dateFields))
  return async ({ ctx, logEntry }: { input: TInput; ctx: CommandRuntimeContext; logEntry: CommandUndoLogEntry }): Promise<TResult> => {
    const snapshot = resolveRedoSnapshot<TSnapshot>(logEntry)
    const id = snapshot ? getSnapshotId(snapshot) : (logEntry.resourceId ?? null)
    if (!snapshot || !id) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for create command' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const overrides = config.beforeRestore ? await config.beforeRestore({ em, ctx, snapshot }) : undefined
    const buildSeed = () => (overrides ? { ...seedFromSnapshot(snapshot), ...overrides } : seedFromSnapshot(snapshot))
    const findRow = config.findRow
      ? (forkedEm: EntityManager, rowId: string) => config.findRow!({ em: forkedEm, ctx, id: rowId, snapshot })
      : undefined
    let entity!: TEntity
    const restorePhase = async () => {
      entity = await restoreCreatedRow(em, config.entityClass, id, buildSeed, findRow)
    }
    const afterRestorePhase = async () => {
      if (config.afterRestore) {
        await config.afterRestore({ em, ctx, entity, snapshot, logEntry })
      }
    }
    try {
      if (config.transaction) {
        const phases = config.afterRestore ? [restorePhase, afterRestorePhase] : [restorePhase]
        await withAtomicFlush(em, phases, { transaction: true })
      } else {
        await restorePhase()
        await em.flush()
        await afterRestorePhase()
      }
    } catch (err) {
      if (isUniqueViolation(err)) {
        // [internal] prefix: this shared-lib helper has no `t(...)` context; the
        // redo unique-collision is a rare developer-facing edge (the after-snapshot's
        // unique key was re-taken since undo), surfaced via normal error handling.
        throw conflict('[internal] Cannot redo: a record with the same unique key already exists.')
      }
      throw err
    }
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity,
      identifiers: {
        id,
        organizationId: entity.organizationId ?? null,
        tenantId: entity.tenantId ?? null,
      },
      events: config.events,
      indexer: config.indexer,
    })
    return config.buildResult(entity, snapshot)
  }
}
