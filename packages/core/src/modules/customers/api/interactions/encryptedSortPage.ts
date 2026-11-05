import { mapWithConcurrency } from '@open-mercato/shared/lib/query/bounded-decrypt'
import { sortRowsInMemory } from '@open-mercato/shared/lib/query/encrypted-sort'
import { SortDir } from '@open-mercato/shared/lib/query/types'

const DECRYPT_CONCURRENCY = 8
const DEFAULT_ENCRYPTED_SEARCH_MAX_ROWS = 5000

export type EncryptedSortCandidate = { id: string } & Record<string, unknown>

// A substring search over encrypted free text has to decrypt every candidate on
// every page, so unlike the opt-in sort cap this bound is on by default.
export function resolveEncryptedSearchMaxRows(): number {
  const parsed = Number(process.env.OM_ENCRYPTED_SEARCH_MAX_ROWS)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_ENCRYPTED_SEARCH_MAX_ROWS
}

// ILIKE semantics over the decrypted values: case-insensitive, and the term is literal.
export function matchesDecryptedSearch(row: Record<string, unknown>, term: string): boolean {
  const needle = term.toLowerCase()
  return [row.title, row.body].some((value) => typeof value === 'string' && value.toLowerCase().includes(needle))
}

// Re-sorts the bounded candidate set by plaintext on every call and resumes
// from the cursor's id position — SQL keyset comparison against ciphertext
// is meaningless for ordering. A null `sortField` keeps the order the candidates
// arrived in, for a sort column SQL can order itself; `matches` drops decrypted rows.
export async function resolveEncryptedSortPage<T extends EncryptedSortCandidate>(params: {
  candidates: readonly T[]
  decryptRow: (row: T) => Promise<T>
  sortField: string | null
  sortDir: 'asc' | 'desc'
  cursorId: string | null
  limit: number
  matches?: (row: T) => boolean
}): Promise<{ pageIds: string[]; hasMore: boolean }> {
  const decrypted = await mapWithConcurrency(params.candidates, DECRYPT_CONCURRENCY, params.decryptRow)
  const matching = params.matches ? decrypted.filter(params.matches) : decrypted
  const ordered = params.sortField === null
    ? matching
    : sortRowsInMemory(matching, [
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
