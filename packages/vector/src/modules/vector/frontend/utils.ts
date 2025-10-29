import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { VectorSearchHit, VectorIndexEntry } from '@open-mercato/vector'

export async function fetchVectorResults(query: string, limit = 10, signal?: AbortSignal): Promise<{ results: VectorSearchHit[]; error?: string | null }> {
  const response = await apiFetch(`/api/vector/search?q=${encodeURIComponent(query)}&limit=${limit}`, { signal })
  const body = await response.json().catch(() => ({} as any))
  if (!response.ok) {
    const error = typeof body?.error === 'string' ? body.error : 'Vector search failed'
    throw new Error(error)
  }
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
  const response = await apiFetch(`/api/vector/index?${params.toString()}`, { signal: opts.signal })
  const body = await response.json().catch(() => ({} as any))
  if (!response.ok) {
    const error = typeof body?.error === 'string' ? body.error : 'Vector index fetch failed'
    throw new Error(error)
  }
  return {
    entries: Array.isArray(body?.entries) ? (body.entries as VectorIndexEntry[]) : [],
    error: typeof body?.error === 'string' ? body.error : null,
  }
}
