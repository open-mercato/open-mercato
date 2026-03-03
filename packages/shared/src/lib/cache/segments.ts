import type { CacheStrategy } from '@open-mercato/cache'

export type CacheSegmentAnalysisOptions = {
  keysPattern: string
  deriveSegment: (key: string) => string | null
  filterKey?: (key: string) => boolean
}

export type CacheSegmentInfo = {
  segment: string
  keys: string[]
}

export async function analyzeCacheSegments(
  cache: CacheStrategy,
  options: CacheSegmentAnalysisOptions
): Promise<CacheSegmentInfo[]> {
  const keys = await cache.keys(options.keysPattern)
  const segments = new Map<string, Set<string>>()

  for (const key of keys) {
    if (options.filterKey && !options.filterKey(key)) continue
    const segment = options.deriveSegment(key)
    if (!segment) continue
    if (!segments.has(segment)) segments.set(segment, new Set<string>())
    segments.get(segment)!.add(key)
  }

  const results: CacheSegmentInfo[] = []
  for (const [segment, keySet] of segments.entries()) {
    results.push({
      segment,
      keys: Array.from(keySet).sort(),
    })
  }
  results.sort((a, b) => a.segment.localeCompare(b.segment))
  return results
}

export async function purgeCacheSegment(
  cache: CacheStrategy,
  options: CacheSegmentAnalysisOptions,
  segment: string
): Promise<{ deleted: number; keys: string[] }> {
  const analyses = await analyzeCacheSegments(cache, options)
  const target = analyses.find((entry) => entry.segment === segment)
  if (!target) return { deleted: 0, keys: [] }

  let deleted = 0
  for (const key of target.keys) {
    const removed = await cache.delete(key)
    if (removed) deleted += 1
  }

  return { deleted, keys: target.keys }
}
