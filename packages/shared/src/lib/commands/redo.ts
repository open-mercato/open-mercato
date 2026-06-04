import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext, CommandUndoLogEntry } from './types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { extractUndoPayload, type UndoPayload } from './undo'
import { emitCrudSideEffects } from './helpers'

type EntityClass<T> = abstract new (...args: never[]) => T

type ScopedSoftDeletable = {
  id: string
  organizationId?: string | null
  tenantId?: string | null
  deletedAt?: Date | null
  isActive?: boolean
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
): Promise<TEntity> {
  const existing = (await em.findOne(entityClass as never, { id } as never)) as TEntity | null
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
  /** Pulls the original primary id out of the after-snapshot (e.g. `(s) => s.id`). */
  getSnapshotId: (snapshot: TSnapshot) => string | null | undefined
  /** Maps the after-snapshot back to a create seed; MUST include the original id. */
  seedFromSnapshot: (snapshot: TSnapshot) => Record<string, unknown>
  /** Builds the command result (mirrors `execute`'s return), e.g. `(e) => ({ currencyId: e.id })`. */
  buildResult: (entity: TEntity, snapshot: TSnapshot) => TResult
  events?: CrudEventsConfig<any>
  indexer?: CrudIndexerConfig<any>
  /** Optional extra side effects after the row is restored (e.g. query-index upserts). */
  afterRestore?: (args: {
    em: EntityManager
    ctx: CommandRuntimeContext
    entity: TEntity
    snapshot: TSnapshot
  }) => Promise<void> | void
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
  return async ({ ctx, logEntry }: { input: TInput; ctx: CommandRuntimeContext; logEntry: CommandUndoLogEntry }): Promise<TResult> => {
    const snapshot = resolveRedoSnapshot<TSnapshot>(logEntry)
    const id = snapshot ? config.getSnapshotId(snapshot) : (logEntry.resourceId ?? null)
    if (!snapshot || !id) {
      throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for create command' })
    }
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const entity = await restoreCreatedRow(em, config.entityClass, id, () => config.seedFromSnapshot(snapshot))
    await em.flush()
    if (config.afterRestore) {
      await config.afterRestore({ em, ctx, entity, snapshot })
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
