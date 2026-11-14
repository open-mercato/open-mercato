import { LockMode, type EntityName, type FilterQuery } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { snapshotsEqual } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

const UPDATE_REDO_LOG = Symbol('eudr.update.redoLog')

type RedoContext = CommandRuntimeContext & { [UPDATE_REDO_LOG]?: CommandUndoLogEntry }
type ScopedRecord = { id: string; tenantId: string; organizationId: string }

export function withUpdateRedoLog(ctx: CommandRuntimeContext, logEntry: CommandUndoLogEntry): CommandRuntimeContext {
  return { ...ctx, [UPDATE_REDO_LOG]: logEntry } as RedoContext
}

function comparableSnapshot(snapshot: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!snapshot) return null
  const { updatedAt: _updatedAt, ...fields } = snapshot
  return fields
}

export async function guardUpdateRedo<TEntity extends ScopedRecord>(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  entityClass: EntityName<TEntity>,
  record: TEntity,
  loadSnapshot: (em: EntityManager, id: string) => Promise<Record<string, unknown> | null>,
): Promise<void> {
  const logEntry = (ctx as RedoContext)[UPDATE_REDO_LOG]
  if (!logEntry) return
  const before = extractUndoPayload<{ before?: Record<string, unknown> | null }>(logEntry)?.before
  const scope = { tenantId: record.tenantId, organizationId: record.organizationId }
  const currentRecord = await findOneWithDecryption(em, entityClass, {
    id: record.id,
    ...scope,
    deletedAt: null,
  } as FilterQuery<TEntity>, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
  const current = currentRecord ? await loadSnapshot(em, record.id) : null
  if (!before || !current || !snapshotsEqual(comparableSnapshot(before), comparableSnapshot(current))) {
    const { translate } = await resolveTranslations()
    throw new CrudHttpError(409, {
      error: translate('eudr.errors.redoConflict'),
      code: 'eudr.errors.redoConflict',
    })
  }
}
