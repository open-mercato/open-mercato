import crypto from 'node:crypto'
import { hashForLookup, legacyHashForLookup, lookupHashCandidates } from '../aes'

const originalEnv = { ...process.env }

function clearLookupEnv() {
  delete process.env.LOOKUP_HASH_PEPPER
  delete process.env.LOOKUP_HASH_OLD_PEPPER
  delete process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
  delete process.env.TENANT_DATA_ENCRYPTION_KEY
}

describe('hashForLookup keyed digest (issue #2718)', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('emits a keyed v2 HMAC when a lookup pepper is configured', () => {
    clearLookupEnv()
    process.env.LOOKUP_HASH_PEPPER = 'installation-pepper-secret-value'
    const digest = hashForLookup('User@Example.com')
    expect(digest.startsWith('v2:')).toBe(true)
    const expected = crypto
      .createHmac('sha256', 'installation-pepper-secret-value')
      .update('user@example.com')
      .digest('hex')
    expect(digest).toBe(`v2:${expected}`)
  })

  it('is not equal to the legacy unkeyed sha256 (defeats precomputed rainbow tables)', () => {
    clearLookupEnv()
    process.env.LOOKUP_HASH_PEPPER = 'installation-pepper-secret-value'
    const keyed = hashForLookup('user@example.com')
    const legacy = legacyHashForLookup('user@example.com')
    expect(keyed).not.toBe(legacy)
    // The legacy digest is exactly what an attacker would precompute.
    const naive = crypto.createHash('sha256').update('user@example.com').digest('hex')
    expect(legacy).toBe(naive)
    expect(keyed).not.toContain(naive)
  })

  it('produces different digests across installations (no cross-installation correlation)', () => {
    clearLookupEnv()
    process.env.LOOKUP_HASH_PEPPER = 'pepper-installation-a'
    const a = hashForLookup('user@example.com')
    process.env.LOOKUP_HASH_PEPPER = 'pepper-installation-b'
    const b = hashForLookup('user@example.com')
    expect(a).not.toBe(b)
  })

  it('binds the digest to the optional field/entity context (not portable across columns)', () => {
    clearLookupEnv()
    process.env.LOOKUP_HASH_PEPPER = 'installation-pepper-secret-value'
    const withoutContext = hashForLookup('user@example.com')
    const emailContext = hashForLookup('user@example.com', 'auth.user:email')
    const phoneContext = hashForLookup('user@example.com', 'auth.user:phone')
    expect(emailContext).not.toBe(withoutContext)
    expect(emailContext).not.toBe(phoneContext)
  })

  it('normalizes case and surrounding whitespace before hashing', () => {
    clearLookupEnv()
    process.env.LOOKUP_HASH_PEPPER = 'installation-pepper-secret-value'
    expect(hashForLookup('  User@Example.com  ')).toBe(hashForLookup('user@example.com'))
  })

  it('resolves the pepper from existing encryption secrets when no dedicated pepper is set', () => {
    clearLookupEnv()
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = 'fallback-secret'
    const fromFallback = hashForLookup('user@example.com')
    expect(fromFallback.startsWith('v2:')).toBe(true)

    clearLookupEnv()
    process.env.TENANT_DATA_ENCRYPTION_KEY = 'fallback-secret'
    const fromKey = hashForLookup('user@example.com')
    expect(fromKey).toBe(fromFallback)
  })

  it('prefers LOOKUP_HASH_PEPPER over the encryption fallback secrets', () => {
    clearLookupEnv()
    process.env.LOOKUP_HASH_PEPPER = 'dedicated-pepper'
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = 'fallback-secret'
    const expected = crypto
      .createHmac('sha256', 'dedicated-pepper')
      .update('user@example.com')
      .digest('hex')
    expect(hashForLookup('user@example.com')).toBe(`v2:${expected}`)
  })

  it('falls back to the legacy unkeyed digest only when no secret is configured', () => {
    clearLookupEnv()
    const digest = hashForLookup('user@example.com')
    expect(digest.startsWith('v2:')).toBe(false)
    expect(digest).toBe(legacyHashForLookup('user@example.com'))
  })

  it('exposes keyed and legacy candidates for migration-window reads', () => {
    clearLookupEnv()
    process.env.LOOKUP_HASH_PEPPER = 'installation-pepper-secret-value'
    const candidates = lookupHashCandidates('user@example.com')
    expect(candidates).toEqual([
      hashForLookup('user@example.com'),
      legacyHashForLookup('user@example.com'),
    ])
    expect(candidates).toHaveLength(2)
  })

  it('collapses candidates to a single value when running in legacy (no-pepper) mode', () => {
    clearLookupEnv()
    const candidates = lookupHashCandidates('user@example.com')
    expect(candidates).toEqual([legacyHashForLookup('user@example.com')])
    expect(candidates).toHaveLength(1)
  })

  it('matches the previous fallback pepper with the original context while new writes use the current pepper', () => {
    clearLookupEnv()
    const email = 'User@Example.com '
    const context = 'auth.user:email'
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = 'previous-fallback-secret'
    const previous = hashForLookup(email, context)

    process.env.LOOKUP_HASH_PEPPER = 'replacement-pepper'
    process.env.LOOKUP_HASH_OLD_PEPPER = ' "previous-fallback-secret" '
    const current = hashForLookup(email, context)

    expect(current).not.toBe(previous)
    expect(lookupHashCandidates(email, context)).toEqual([current, previous, legacyHashForLookup(email)])
    expect(lookupHashCandidates(email, 'different-context')).not.toContain(previous)

    delete process.env.LOOKUP_HASH_OLD_PEPPER
    expect(lookupHashCandidates(email, context)).toEqual([current, legacyHashForLookup(email)])
  })

  it('deduplicates matching peppers and keeps the previous pepper out of writes without a current secret', () => {
    clearLookupEnv()
    const email = 'user@example.com'
    process.env.LOOKUP_HASH_PEPPER = 'shared-pepper'
    const keyed = hashForLookup(email)
    const legacy = legacyHashForLookup(email)
    process.env.LOOKUP_HASH_OLD_PEPPER = 'shared-pepper'
    expect(lookupHashCandidates(email)).toEqual([keyed, legacy])

    delete process.env.LOOKUP_HASH_PEPPER
    expect(hashForLookup(email)).toBe(legacy)
    expect(lookupHashCandidates(email)).toEqual([legacy, keyed])
  })
})
