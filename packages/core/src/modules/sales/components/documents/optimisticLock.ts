import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

type Translate = (key: string, fallback?: string) => string

export function handleSectionMutationError(
  err: unknown,
  t: Translate,
  refresh: () => void,
): boolean {
  if (surfaceRecordConflict(err, t, { onRefresh: refresh })) {
    refresh()
    return true
  }
  return false
}
