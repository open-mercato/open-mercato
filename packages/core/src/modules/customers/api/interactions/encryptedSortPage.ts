import { mapWithConcurrency } from '@open-mercato/shared/lib/query/bounded-decrypt'
import { sortRowsInMemory } from '@open-mercato/shared/lib/query/encrypted-sort'
import { SortDir } from '@open-mercato/shared/lib/query/types'

const DECRYPT_CONCURRENCY = 8

export type EncryptedSortCandidate = { id: string } & Record<string, unknown>

// Re-sorts the bounded candidate set by plaintext on every call and resumes
// from the cursor's id position — SQL keyset comparison against ciphertext
// is meaningless for ordering.
export async function resolveEncryptedSortPage<T extends EncryptedSortCandidate>(params: {
  candidates: readonly T[]
  decryptRow: (row: T) => Promise<T>
  sortField: string
  sortDir: 'asc' | 'desc'
  cursorId: string | null
  limit: number
}): Promise<{ pageIds: string[]; hasMore: boolean }> {
  const decrypted = await mapWithConcurrency(params.candidates, DECRYPT_CONCURRENCY, params.decryptRow)
  const ordered = sortRowsInMemory(decrypted, [
    { field: params.sortField, dir: params.sortDir === 'desc' ? SortDir.Desc : SortDir.Asc },
  ])
  let start = 0
  if (params.cursorId) {
    const idx = ordered.findIndex((row) => row.id === params.cursorId)
    start = idx >= 0 ? idx + 1 : 0
  }
  const page = ordered.slice(start, start + params.limit)
  return {
    pageIds: page.map((row) => row.id),
    hasMore: start + params.limit < ordered.length,
  }
}
