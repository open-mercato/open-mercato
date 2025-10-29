import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { VectorSearchHit } from '@open-mercato/vector'

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
