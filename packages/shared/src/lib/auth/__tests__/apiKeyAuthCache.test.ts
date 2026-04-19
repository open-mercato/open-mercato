import { createApiKeyAuthCache } from '../apiKeyAuthCache'

describe('createApiKeyAuthCache', () => {
  function fakeClock(initial = 0) {
    let current = initial
    return {
      now: () => current,
      advance(ms: number) {
        current += ms
      },
    }
  }

  const sampleAuth = {
    sub: 'api_key:abc',
    tenantId: 't',
    orgId: 'o',
    roles: ['admin'],
    isApiKey: true,
    keyId: 'key-1',
    keyName: 'test',
  }

  it('returns cached auth within TTL without re-resolving', () => {
    const clock = fakeClock()
    const cache = createApiKeyAuthCache({ successTtlMs: 30_000, now: clock.now })
    expect(cache.get('secret')).toBeUndefined()
    cache.setSuccess('secret', sampleAuth, null)
    expect(cache.get('secret')).toEqual(sampleAuth)

    clock.advance(29_000)
    expect(cache.get('secret')).toEqual(sampleAuth)
  })

  it('expires cached auth after TTL', () => {
    const clock = fakeClock()
    const cache = createApiKeyAuthCache({ successTtlMs: 30_000, now: clock.now })
    cache.setSuccess('secret', sampleAuth, null)
    clock.advance(30_001)
    expect(cache.get('secret')).toBeUndefined()
  })

  it('respects the API key expiresAt upper bound', () => {
    const clock = fakeClock(1_000)
    const cache = createApiKeyAuthCache({ successTtlMs: 60_000, now: clock.now })
    cache.setSuccess('secret', sampleAuth, 5_000)
    expect(cache.get('secret')).toEqual(sampleAuth)
    clock.advance(4_500)
    expect(cache.get('secret')).toBeUndefined()
  })

  it('does not cache already-expired keys', () => {
    const clock = fakeClock(10_000)
    const cache = createApiKeyAuthCache({ successTtlMs: 60_000, now: clock.now })
    cache.setSuccess('secret', sampleAuth, 5_000)
    expect(cache.get('secret')).toBeUndefined()
  })

  it('caches null miss with shorter TTL to deter repeated bcrypt probes', () => {
    const clock = fakeClock()
    const cache = createApiKeyAuthCache({ successTtlMs: 30_000, negativeTtlMs: 5_000, now: clock.now })
    cache.setMiss('bad-secret')
    expect(cache.get('bad-secret')).toBeNull()
    clock.advance(5_001)
    expect(cache.get('bad-secret')).toBeUndefined()
  })

  it('debounces lastUsedAt writes per key id', () => {
    const clock = fakeClock()
    const cache = createApiKeyAuthCache({ lastUsedWriteIntervalMs: 60_000, now: clock.now })
    expect(cache.shouldWriteLastUsed('key-1')).toBe(true)
    expect(cache.shouldWriteLastUsed('key-1')).toBe(false)
    clock.advance(59_999)
    expect(cache.shouldWriteLastUsed('key-1')).toBe(false)
    clock.advance(2)
    expect(cache.shouldWriteLastUsed('key-1')).toBe(true)
    expect(cache.shouldWriteLastUsed('key-2')).toBe(true)
  })

  it('invalidates cached entries for a revoked key id', () => {
    const clock = fakeClock()
    const cache = createApiKeyAuthCache({ successTtlMs: 60_000, now: clock.now })
    cache.setSuccess('secret-a', { ...sampleAuth, keyId: 'key-1' }, null)
    cache.setSuccess('secret-b', { ...sampleAuth, keyId: 'key-2' }, null)

    cache.invalidateByKeyId('key-1')
    expect(cache.get('secret-a')).toBeUndefined()
    expect(cache.get('secret-b')).toEqual({ ...sampleAuth, keyId: 'key-2' })
  })

  it('clears the lastUsedAt debounce when a key is invalidated', () => {
    const clock = fakeClock()
    const cache = createApiKeyAuthCache({ lastUsedWriteIntervalMs: 60_000, now: clock.now })
    expect(cache.shouldWriteLastUsed('key-1')).toBe(true)
    expect(cache.shouldWriteLastUsed('key-1')).toBe(false)
    cache.invalidateByKeyId('key-1')
    expect(cache.shouldWriteLastUsed('key-1')).toBe(true)
  })

  it('evicts the oldest entry when exceeding the configured max size', () => {
    const clock = fakeClock()
    const cache = createApiKeyAuthCache({ successTtlMs: 60_000, maxEntries: 2, now: clock.now })
    cache.setSuccess('secret-a', { ...sampleAuth, keyId: 'a' }, null)
    cache.setSuccess('secret-b', { ...sampleAuth, keyId: 'b' }, null)
    cache.setSuccess('secret-c', { ...sampleAuth, keyId: 'c' }, null)
    expect(cache.get('secret-a')).toBeUndefined()
    expect(cache.get('secret-b')).toEqual({ ...sampleAuth, keyId: 'b' })
    expect(cache.get('secret-c')).toEqual({ ...sampleAuth, keyId: 'c' })
  })

  it('ignores empty secrets', () => {
    const cache = createApiKeyAuthCache()
    cache.setSuccess('', sampleAuth, null)
    cache.setMiss('')
    expect(cache.get('')).toBeUndefined()
  })
})
