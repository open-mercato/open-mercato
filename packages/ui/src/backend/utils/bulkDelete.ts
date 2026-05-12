"use client"

export type BulkDeleteFailure = {
  id: string
  code: string | null
  message: string
}

export type BulkDeleteOutcome<T extends { id: string }> = {
  succeeded: T[]
  failures: BulkDeleteFailure[]
}

export type BulkDeleteOptions = {
  fallbackErrorMessage?: string
  logTag?: string
}

export async function runBulkDelete<T extends { id: string }>(
  rows: T[],
  deleteOne: (row: T) => Promise<void>,
  options?: BulkDeleteOptions,
): Promise<BulkDeleteOutcome<T>> {
  const fallback = options?.fallbackErrorMessage ?? 'Delete failed'
  const logTag = options?.logTag
  const succeeded: T[] = []
  const failures: BulkDeleteFailure[] = []
  for (const row of rows) {
    try {
      await deleteOne(row)
      succeeded.push(row)
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim().length > 0 ? err.message : fallback
      const rawCode =
        err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined
      const code = typeof rawCode === 'string' && rawCode.length > 0 ? rawCode : null
      failures.push({ id: row.id, code, message })
      if (logTag && typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(`[${logTag}] bulk delete failed`, { id: row.id, code, message, err })
      }
    }
  }
  return { succeeded, failures }
}

export type BulkDeleteFailureGroup = {
  key: string
  count: number
  sampleMessage: string
  ids: string[]
}

// Keyed by `code` when present so semantically identical failures collapse into
// one toast even if their message text varies (e.g. row-specific dependency
// counts). Falls back to the raw message when the server did not surface a code.
export function groupBulkDeleteFailures(
  failures: BulkDeleteFailure[],
): BulkDeleteFailureGroup[] {
  const buckets = new Map<string, BulkDeleteFailureGroup>()
  for (const failure of failures) {
    const key = failure.code || failure.message || 'unknown'
    const existing = buckets.get(key)
    if (existing) {
      existing.count += 1
      existing.ids.push(failure.id)
      continue
    }
    buckets.set(key, {
      key,
      count: 1,
      sampleMessage: failure.message,
      ids: [failure.id],
    })
  }
  return Array.from(buckets.values())
}
