import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isUnchangedSince, type UndoSnapshot } from './undo-guard'

export const REDO_CONFLICT_CODE = 'eudr.errors.redoConflict'

const UPDATE_REDO_LOG = Symbol('eudr.update.redoLog')

type RedoContext = CommandRuntimeContext & { [UPDATE_REDO_LOG]?: CommandUndoLogEntry }

export function withUpdateRedoLog(ctx: CommandRuntimeContext, logEntry: CommandUndoLogEntry): CommandRuntimeContext {
  return { ...ctx, [UPDATE_REDO_LOG]: logEntry } as RedoContext
}

export async function guardUpdateRedo(ctx: CommandRuntimeContext, current: UndoSnapshot): Promise<void> {
  const logEntry = (ctx as RedoContext)[UPDATE_REDO_LOG]
  if (!logEntry) return
  const expected = extractUndoPayload<{ before?: UndoSnapshot | null }>(logEntry)?.before
  if (expected && isUnchangedSince(current, expected)) return
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(409, {
    error: translate(
      REDO_CONFLICT_CODE,
      'This record changed after it was undone. Redo was refused and the current version was kept. Reload the record and re-apply your change manually.',
    ),
    code: REDO_CONFLICT_CODE,
  })
}
