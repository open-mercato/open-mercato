import { buildChanges, requireTenantScope, requireId } from '@open-mercato/shared/lib/commands/helpers'

describe('command helpers', () => {
  describe('buildChanges', () => {
    it('returns diff for changed keys', () => {
      const diff = buildChanges({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }, ['a', 'b'])
      expect(diff).toEqual({ b: { from: 2, to: 3 } })
    })

    it('handles missing before snapshot', () => {
      expect(buildChanges(null, { a: 1 }, ['a'])).toEqual({})
    })
  })

  describe('requireTenantScope', () => {
    it('prefers requested when allowed', () => {
      expect(requireTenantScope('tenant-1', 'tenant-1')).toBe('tenant-1')
    })

    it('throws when requested mismatches auth tenant', () => {
      expect(() => requireTenantScope('tenant-1', 'tenant-2')).toThrow('Forbidden')
    })

    it('throws when tenant missing', () => {
      expect(() => requireTenantScope(null, null)).toThrow('Tenant scope required')
    })
  })

  describe('requireId', () => {
    it('returns string id directly', () => {
      expect(requireId('123')).toBe('123')
    })

    it('extracts from object tokens', () => {
      expect(requireId({ body: { id: 'abc' } })).toBe('abc')
    })

    it('throws when missing', () => {
      expect(() => requireId(null)).toThrow('ID is required')
    })
  })
})
