import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

type Translate = (key: string, fallback?: string) => string

export function rowOptimisticVersion(row: { updatedAt?: string | null } | null | undefined): string | undefined {
  const value = row?.updatedAt
  return typeof value === 'string' && value.length ? value : undefined
}

/**
 * Read a row's `updated_at` / `updatedAt` version from an untyped API record
 * without `any`. Returns `null` when neither key holds a non-empty string.
 */
export function readRowUpdatedAt(source: unknown): string | null {
  if (!source || typeof source !== 'object') return null
  const record = source as Record<string, unknown>
  const snake = record.updated_at
  if (typeof snake === 'string' && snake.length) return snake
  const camel = record.updatedAt
  if (typeof camel === 'string' && camel.length) return camel
  return null
}

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
