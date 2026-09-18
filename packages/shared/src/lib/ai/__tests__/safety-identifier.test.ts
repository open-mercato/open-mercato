import { computeEndUserIdentifier, deriveAiSafetyIdentifierSecret } from '../safety-identifier'

const BASE_SECRET = 'unit-test-base-secret'
const HEX_64 = /^[0-9a-f]{64}$/

describe('safety-identifier', () => {
  describe('deriveAiSafetyIdentifierSecret', () => {
    it('is deterministic and memoized for a given base secret', () => {
      const first = deriveAiSafetyIdentifierSecret(BASE_SECRET)
      const second = deriveAiSafetyIdentifierSecret(BASE_SECRET)
      expect(first).toBe(second)
      expect(first).toMatch(HEX_64)
    })

    it('produces a different key for a different base secret', () => {
      expect(deriveAiSafetyIdentifierSecret(BASE_SECRET)).not.toBe(
        deriveAiSafetyIdentifierSecret('other-base-secret'),
      )
    })

    it('throws when no base secret is available', () => {
      const previous = process.env.JWT_SECRET
      delete process.env.JWT_SECRET
      try {
        expect(() => deriveAiSafetyIdentifierSecret()).toThrow(/JWT_SECRET/)
      } finally {
        if (previous !== undefined) process.env.JWT_SECRET = previous
      }
    })
  })

  describe('computeEndUserIdentifier', () => {
    it('is stable for the same (tenant, user) pair', () => {
      const a = computeEndUserIdentifier('tenant-1', 'user-1', { baseSecret: BASE_SECRET })
      const b = computeEndUserIdentifier('tenant-1', 'user-1', { baseSecret: BASE_SECRET })
      expect(a).toBe(b)
      expect(a).toMatch(HEX_64)
    })

    it('separates the same user across tenants (tenant-salted)', () => {
      const t1 = computeEndUserIdentifier('tenant-1', 'user-1', { baseSecret: BASE_SECRET })
      const t2 = computeEndUserIdentifier('tenant-2', 'user-1', { baseSecret: BASE_SECRET })
      expect(t1).not.toBe(t2)
    })

    it('separates different users within the same tenant', () => {
      const u1 = computeEndUserIdentifier('tenant-1', 'user-1', { baseSecret: BASE_SECRET })
      const u2 = computeEndUserIdentifier('tenant-1', 'user-2', { baseSecret: BASE_SECRET })
      expect(u1).not.toBe(u2)
    })

    it('never leaks the raw tenant or user id', () => {
      const id = computeEndUserIdentifier('tenant-1', 'user-1', { baseSecret: BASE_SECRET })
      expect(id).not.toContain('tenant-1')
      expect(id).not.toContain('user-1')
    })

    it('treats a null tenant as an empty salt without throwing', () => {
      const withNull = computeEndUserIdentifier(null, 'user-1', { baseSecret: BASE_SECRET })
      const withEmpty = computeEndUserIdentifier('', 'user-1', { baseSecret: BASE_SECRET })
      expect(withNull).toMatch(HEX_64)
      expect(withNull).toBe(withEmpty)
    })

    it('throws when userId is empty', () => {
      expect(() => computeEndUserIdentifier('tenant-1', '   ', { baseSecret: BASE_SECRET })).toThrow(
        /userId/,
      )
    })
  })
})
