import { extractApiKeyFromHeaders, hasRequiredFeatures } from '../auth'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'

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

  it('grants a bare-segment requirement from a prefix wildcard (issue #2723)', () => {
    expect(
      hasRequiredFeatures(['entities'], ['entities.*'], false)
    ).toBe(true)
  })

  it('matches the canonical matcher for bare-segment requirements with and without rbacService', () => {
    const rbacService = {
      hasAllFeatures: jest.fn((required: string[], granted: string[]) =>
        hasAllFeatures(required, granted)
      ),
    }

    const withService = hasRequiredFeatures(
      ['entities'],
      ['entities.*'],
      false,
      rbacService as any
    )
    const withoutService = hasRequiredFeatures(['entities'], ['entities.*'], false)

    expect(withService).toBe(true)
    expect(withoutService).toBe(true)
    expect(withService).toBe(withoutService)
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

  it('uses the shared policy even when a legacy rbacService argument is provided', () => {
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
    expect(rbacService.hasAllFeatures).not.toHaveBeenCalled()
  })
})
