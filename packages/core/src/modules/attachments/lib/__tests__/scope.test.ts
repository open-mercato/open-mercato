import {
  isValidAttachmentScopePair,
  resolveAttachmentScopePair,
} from '../scope'

describe('attachment scope invariant helpers', () => {
  describe('isValidAttachmentScopePair', () => {
    it('accepts a fully scoped pair', () => {
      expect(isValidAttachmentScopePair({ organizationId: 'org-1', tenantId: 'tenant-1' })).toBe(true)
    })

    it('accepts a fully global pair (both null/undefined)', () => {
      expect(isValidAttachmentScopePair({ organizationId: null, tenantId: null })).toBe(true)
      expect(isValidAttachmentScopePair({})).toBe(true)
    })

    it('rejects partial-null pairs in both directions', () => {
      expect(isValidAttachmentScopePair({ organizationId: 'org-1', tenantId: null })).toBe(false)
      expect(isValidAttachmentScopePair({ organizationId: null, tenantId: 'tenant-1' })).toBe(false)
    })

    it('treats blank/whitespace as null', () => {
      expect(isValidAttachmentScopePair({ organizationId: '   ', tenantId: 'tenant-1' })).toBe(false)
      expect(isValidAttachmentScopePair({ organizationId: '   ', tenantId: '' })).toBe(true)
    })
  })

  describe('resolveAttachmentScopePair', () => {
    it('returns the first valid candidate as a normalized pair', () => {
      expect(
        resolveAttachmentScopePair({ organizationId: ' org-1 ', tenantId: ' tenant-1 ' }),
      ).toEqual({ organizationId: 'org-1', tenantId: 'tenant-1' })
    })

    it('skips a partial-null candidate and falls back to the next valid one', () => {
      expect(
        resolveAttachmentScopePair(
          { organizationId: 'org-1', tenantId: null },
          { organizationId: 'org-2', tenantId: 'tenant-2' },
        ),
      ).toEqual({ organizationId: 'org-2', tenantId: 'tenant-2' })
    })

    it('returns a global pair when the first valid candidate is fully null', () => {
      expect(
        resolveAttachmentScopePair({ organizationId: null, tenantId: null }),
      ).toEqual({ organizationId: null, tenantId: null })
    })

    it('ignores nullish candidates', () => {
      expect(
        resolveAttachmentScopePair(null, undefined, { organizationId: 'org-1', tenantId: 'tenant-1' }),
      ).toEqual({ organizationId: 'org-1', tenantId: 'tenant-1' })
    })

    it('returns null when no candidate forms a valid pair', () => {
      expect(
        resolveAttachmentScopePair(
          { organizationId: 'org-1', tenantId: null },
          { organizationId: null, tenantId: 'tenant-2' },
        ),
      ).toBeNull()
    })
  })
})
