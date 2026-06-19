import { extractOptimisticLockConflict } from '../utils/optimisticLock'
import { showRecordConflict } from './store'

export {
  showRecordConflict,
  dismissRecordConflict,
  useRecordConflict,
  getRecordConflictForTest,
  type RecordConflictEntry,
  type ShowRecordConflictInput,
} from './store'
export { RecordConflictBanner } from './RecordConflictBanner'

type Translate = (key: string, fallback?: string) => string

export type SurfaceRecordConflictOptions = {
  /** Custom refresh handler. Omit to let the banner reload the page. */
  onRefresh?: (() => void) | null
  /** Localized title override; the banner falls back to a generic title. */
  title?: string | null
}

/**
 * If `error` is an OSS optimistic-lock conflict (HTTP 409 with
 * `code: 'optimistic_lock_conflict'`), push the localized "record modified"
 * message onto the shared conflict bar and return `true`. Otherwise return
 * `false` so callers can fall back to their normal error handling.
 *
 * This is the single entry point every form uses, so the conflict surfaces the
 * same persistent, error-styled bar everywhere.
 */
export function surfaceRecordConflict(
  error: unknown,
  t: Translate,
  options: SurfaceRecordConflictOptions = {},
): boolean {
  const conflict = extractOptimisticLockConflict(error)
  if (!conflict) return false
  showRecordConflict({
    message: t(
      'ui.forms.flash.recordModified',
      'This record was modified by someone else. Refresh and try again.',
    ),
    title: options.title ?? null,
    currentUpdatedAt: conflict.currentUpdatedAt,
    onRefresh: options.onRefresh ?? null,
  })
  return true
}
