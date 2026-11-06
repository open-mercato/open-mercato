import type { EvalSetManifest, ManifestScope } from './manifest'

export const EVAL_SET_MANIFEST_CACHE_MAX_BYTES = 32 * 1024 * 1024

type CacheEntry = { manifest: EvalSetManifest; bytes: number }

export type EvalSetManifestCache = {
  get: (key: string) => EvalSetManifest | undefined
  set: (key: string, manifest: EvalSetManifest) => void
  clear: () => void
  totalBytes: () => number
  size: () => number
}

export function evalSetManifestCacheKey(scope: ManifestScope, version: string): string {
  return `${scope.tenantId}:${scope.organizationId}:${version}`
}

export function approximateManifestBytes(manifest: EvalSetManifest): number {
  return Buffer.byteLength(JSON.stringify(manifest), 'utf8')
}

/**
 * Least-recently-used cache of resolved eval-set manifests, bounded by the
 * approximate serialized size of its entries rather than their count: a single
 * manifest may be up to OM_AGENT_EVAL_SET_MAX_BYTES, so a count bound alone
 * does not bound memory. A manifest larger than the whole budget is not cached.
 */
export function createEvalSetManifestCache(
  maxBytes: number = EVAL_SET_MANIFEST_CACHE_MAX_BYTES,
): EvalSetManifestCache {
  const entries = new Map<string, CacheEntry>()
  let usedBytes = 0

  const remove = (key: string) => {
    const existing = entries.get(key)
    if (!existing) return
    entries.delete(key)
    usedBytes -= existing.bytes
  }

  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key)
      entries.set(key, entry)
      return entry.manifest
    },
    set(key, manifest) {
      remove(key)
      const bytes = approximateManifestBytes(manifest)
      if (bytes > maxBytes) return
      while (usedBytes + bytes > maxBytes) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        remove(oldest.value)
      }
      entries.set(key, { manifest, bytes })
      usedBytes += bytes
    },
    clear() {
      entries.clear()
      usedBytes = 0
    },
    totalBytes: () => usedBytes,
    size: () => entries.size,
  }
}
