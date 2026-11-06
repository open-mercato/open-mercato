import { EVAL_SET_FORMAT, EVAL_SET_FORMAT_VERSION, type EvalSetManifest } from '../lib/eval/manifest'
import {
  EVAL_SET_MANIFEST_CACHE_MAX_BYTES,
  approximateManifestBytes,
  createEvalSetManifestCache,
  evalSetManifestCacheKey,
} from '../lib/eval/manifestCache'

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const OTHER_SCOPE = { tenantId: '33333333-3333-4333-8333-333333333333', organizationId: '44444444-4444-4444-8444-444444444444' }

function manifestWithLabel(label: string): EvalSetManifest {
  return {
    format: EVAL_SET_FORMAT,
    formatVersion: EVAL_SET_FORMAT_VERSION,
    agentId: 'content_review.validator',
    label,
    source: 'db',
    assertions: [],
    cases: [],
  }
}

describe('eval set manifest cache', () => {
  it('defaults to a 32 MiB budget and keys entries by tenant, organization and version', () => {
    expect(EVAL_SET_MANIFEST_CACHE_MAX_BYTES).toBe(32 * 1024 * 1024)
    expect(evalSetManifestCacheKey(SCOPE, 'sha256:abc')).toBe(evalSetManifestCacheKey(SCOPE, 'sha256:abc'))
    expect(evalSetManifestCacheKey(SCOPE, 'sha256:abc')).not.toBe(evalSetManifestCacheKey(OTHER_SCOPE, 'sha256:abc'))
    expect(evalSetManifestCacheKey(SCOPE, 'sha256:abc')).not.toBe(evalSetManifestCacheKey(SCOPE, 'sha256:def'))
  })

  it('evicts the least recently used entries once the byte budget is exceeded', () => {
    const first = manifestWithLabel('a'.repeat(400))
    const second = manifestWithLabel('b'.repeat(400))
    const third = manifestWithLabel('c'.repeat(400))
    const entryBytes = approximateManifestBytes(first)
    const cache = createEvalSetManifestCache(entryBytes * 2 + 10)

    cache.set('first', first)
    cache.set('second', second)
    expect(cache.get('first')).toBe(first)
    cache.set('third', third)

    expect(cache.get('second')).toBeUndefined()
    expect(cache.get('first')).toBe(first)
    expect(cache.get('third')).toBe(third)
    expect(cache.size()).toBe(2)
    expect(cache.totalBytes()).toBe(entryBytes * 2)
  })

  it('does not cache a manifest larger than the whole budget and keeps existing entries', () => {
    const small = manifestWithLabel('small')
    const huge = manifestWithLabel('h'.repeat(5000))
    const cache = createEvalSetManifestCache(approximateManifestBytes(small) * 3)
    cache.set('small', small)
    cache.set('huge', huge)
    expect(cache.get('huge')).toBeUndefined()
    expect(cache.get('small')).toBe(small)
  })

  it('replaces an existing key without double counting its bytes and clears fully', () => {
    const manifest = manifestWithLabel('same')
    const cache = createEvalSetManifestCache(10000)
    cache.set('key', manifest)
    cache.set('key', manifest)
    expect(cache.totalBytes()).toBe(approximateManifestBytes(manifest))
    cache.clear()
    expect(cache.size()).toBe(0)
    expect(cache.totalBytes()).toBe(0)
  })
})
