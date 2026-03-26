import { extractApiKeyFromHeaders, hasRequiredFeatures } from '../auth'

describe('extractApiKeyFromHeaders', () => {
  describe('plain object headers', () => {
    it('extracts from x-api-key header', () => {
      expect(extractApiKeyFromHeaders({ 'x-api-key': 'omk_test123' })).toBe('omk_test123')
    })

    it('extracts from Authorization ApiKey header', () => {
      expect(
        extractApiKeyFromHeaders({ authorization: 'ApiKey omk_test123' })
      ).toBe('omk_test123')
    })

    it('is case-insensitive for ApiKey prefix', () => {
      expect(
        extractApiKeyFromHeaders({ authorization: 'apikey omk_test123' })
      ).toBe('omk_test123')
    })

    it('prefers x-api-key over Authorization', () => {
      expect(
        extractApiKeyFromHeaders({
          'x-api-key': 'omk_primary',
          authorization: 'ApiKey omk_secondary',
        })
      ).toBe('omk_primary')
    })

    it('returns null when no key present', () => {
      expect(extractApiKeyFromHeaders({})).toBeNull()
    })

    it('returns null for Bearer token (not API key)', () => {
      expect(
        extractApiKeyFromHeaders({ authorization: 'Bearer jwt_token' })
      ).toBeNull()
    })

    it('trims whitespace', () => {
      expect(extractApiKeyFromHeaders({ 'x-api-key': '  omk_test  ' })).toBe('omk_test')
    })
  })

  describe('Map headers', () => {
    it('extracts from Map', () => {
      const headers = new Map([['x-api-key', 'omk_map_test']])
      expect(extractApiKeyFromHeaders(headers)).toBe('omk_map_test')
    })
  })
})

describe('hasRequiredFeatures', () => {
  it('returns true for super admin', () => {
    expect(hasRequiredFeatures(['admin.only'], [], true)).toBe(true)
  })

  it('returns true when no features required', () => {
    expect(hasRequiredFeatures([], [], false)).toBe(true)
    expect(hasRequiredFeatures(undefined, [], false)).toBe(true)
  })

  it('returns true for direct feature match', () => {
    expect(
      hasRequiredFeatures(
        ['customers.view'],
        ['customers.view', 'customers.edit'],
        false
      )
    ).toBe(true)
  })

  it('returns false for missing feature', () => {
    expect(
      hasRequiredFeatures(['customers.delete'], ['customers.view'], false)
    ).toBe(false)
  })

  it('returns true for global wildcard', () => {
    expect(hasRequiredFeatures(['customers.view'], ['*'], false)).toBe(true)
  })

  it('returns true for prefix wildcard match', () => {
    expect(
      hasRequiredFeatures(['customers.people.view'], ['customers.*'], false)
    ).toBe(true)
  })

  it('returns false for non-matching prefix wildcard', () => {
    expect(
      hasRequiredFeatures(['sales.view'], ['customers.*'], false)
    ).toBe(false)
  })

  it('requires all features (AND logic)', () => {
    expect(
      hasRequiredFeatures(
        ['customers.view', 'sales.view'],
        ['customers.view'],
        false
      )
    ).toBe(false)

    expect(
      hasRequiredFeatures(
        ['customers.view', 'sales.view'],
        ['customers.view', 'sales.view'],
        false
      )
    ).toBe(true)
  })

  it('delegates to rbacService when provided', () => {
    const rbacService = {
      hasAllFeatures: jest.fn().mockReturnValue(true),
    }
    const result = hasRequiredFeatures(
      ['customers.view'],
      ['customers.view'],
      false,
      rbacService as any
    )
    expect(result).toBe(true)
    expect(rbacService.hasAllFeatures).toHaveBeenCalledWith(
      ['customers.view'],
      ['customers.view']
    )
  })
})
