import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { VectorSearchHit, VectorIndexEntry } from '@open-mercato/vector'

export async function fetchVectorResults(query: string, limit = 10, signal?: AbortSignal): Promise<{ results: VectorSearchHit[]; error?: string | null }> {
  const body = await readApiResultOrThrow<{ results?: VectorSearchHit[]; error?: string }>(
    `/api/vector/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { signal },
    { errorMessage: 'Vector search failed', allowNullResult: true },
  )
  return {
    results: Array.isArray(body?.results) ? (body.results as VectorSearchHit[]) : [],
    error: typeof body?.error === 'string' ? body.error : null,
  }
}

export async function fetchVectorIndexEntries(opts: { limit?: number; entityId?: string; signal?: AbortSignal } = {}): Promise<{ entries: VectorIndexEntry[]; error?: string | null }> {
  const params = new URLSearchParams()
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200))
  params.set('limit', String(limit))
  if (opts.entityId) params.set('entityId', opts.entityId)
  const body = await readApiResultOrThrow<{ entries?: VectorIndexEntry[]; error?: string }>(
    `/api/vector/index?${params.toString()}`,
    { signal: opts.signal },
    { errorMessage: 'Vector index fetch failed', allowNullResult: true },
  )
  return {
    entries: Array.isArray(body?.entries) ? (body.entries as VectorIndexEntry[]) : [],
    error: typeof body?.error === 'string' ? body.error : null,
  }
}
