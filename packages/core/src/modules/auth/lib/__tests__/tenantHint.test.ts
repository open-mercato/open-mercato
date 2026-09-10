import { withTenantHintPath, withTenantHintUrl } from '@open-mercato/core/modules/auth/lib/tenantHint'

describe('withTenantHintUrl', () => {
  test('appends the tenant hint to a reset link', () => {
    expect(withTenantHintUrl('https://app.example.com/reset/reset-token-1', 'tenant-1'))
      .toBe('https://app.example.com/reset/reset-token-1?tenant=tenant-1')
  })

  test('leaves the link untouched for a tenantless user', () => {
    expect(withTenantHintUrl('https://app.example.com/reset/reset-token-1', null))
      .toBe('https://app.example.com/reset/reset-token-1')
    expect(withTenantHintUrl('https://app.example.com/reset/reset-token-1', undefined))
      .toBe('https://app.example.com/reset/reset-token-1')
    expect(withTenantHintUrl('https://app.example.com/reset/reset-token-1', '   '))
      .toBe('https://app.example.com/reset/reset-token-1')
  })

  test('escapes a tenant id that would otherwise alter the query string', () => {
    const url = withTenantHintUrl('https://app.example.com/reset/reset-token-1', 'a&b=c d')

    expect(new URL(url).searchParams.get('tenant')).toBe('a&b=c d')
    expect(url).toBe('https://app.example.com/reset/reset-token-1?tenant=a%26b%3Dc+d')
  })

  test('replaces rather than duplicates an existing tenant parameter', () => {
    expect(withTenantHintUrl('https://app.example.com/reset/tok?tenant=forged', 'tenant-1'))
      .toBe('https://app.example.com/reset/tok?tenant=tenant-1')
  })

  test('returns the original value when the url cannot be parsed', () => {
    expect(withTenantHintUrl('not-a-url', 'tenant-1')).toBe('not-a-url')
  })
})

describe('withTenantHintPath', () => {
  test('appends the tenant hint to the login redirect', () => {
    expect(withTenantHintPath('/login', 'tenant-1')).toBe('/login?tenant=tenant-1')
  })

  test('leaves the redirect untouched for a tenantless user', () => {
    expect(withTenantHintPath('/login', null)).toBe('/login')
    expect(withTenantHintPath('/login', '')).toBe('/login')
  })

  test('encodes a tenant id containing url-significant characters', () => {
    expect(withTenantHintPath('/login', 'a&b=c d')).toBe('/login?tenant=a%26b%3Dc%20d')
  })

  test('joins onto a path that already carries a query string', () => {
    expect(withTenantHintPath('/login?next=%2Fbackend', 'tenant-1'))
      .toBe('/login?next=%2Fbackend&tenant=tenant-1')
  })
})
