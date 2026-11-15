const mockTranslate = jest.fn((_key: string, fallback: string) => fallback)

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: mockTranslate }),
}))

jest.mock('openid-client', () => ({
  customFetch: Symbol('openid-client.customFetch'),
  discovery: jest.fn(),
}))

import * as client from 'openid-client'
import type { UrlSafetyReason } from '@open-mercato/shared/lib/url-safety'
import { createOidcFetch, UnsafeOidcUrlError } from '../oidc-url-safety'

import {
  OidcProvider,
  extractIdentityGroups,
  coerceClaimValues,
  normalizeEmailVerifiedClaim,
} from '../oidc-provider'

describe('OidcProvider outbound request safety', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('installs a guarded custom fetch for discovery and subsequent provider requests', async () => {
    const discovery = client.discovery as jest.MockedFunction<typeof client.discovery>
    discovery.mockResolvedValue({} as client.Configuration)

    const provider = new OidcProvider()
    await provider.validateConfig({
      id: 'config-id',
      organizationId: 'organization-id',
      protocol: 'oidc',
      issuer: 'https://idp.example.com',
      clientId: 'client-id',
      allowedDomains: [],
      jitEnabled: false,
      autoLinkByEmail: false,
      isActive: false,
      ssoRequired: false,
      appRoleMappings: {},
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    expect(discovery).toHaveBeenCalledWith(
      new URL('https://idp.example.com'),
      'client-id',
      undefined,
      undefined,
      expect.objectContaining({
        [client.customFetch]: expect.any(Function),
      }),
    )
  })

  test('coalesces discovery for an unchanged configuration', async () => {
    const discovery = client.discovery as jest.MockedFunction<typeof client.discovery>
    discovery.mockResolvedValue({} as client.Configuration)
    const config = {
      id: 'config-id',
      organizationId: 'organization-id',
      protocol: 'oidc',
      issuer: 'https://idp.example.com',
      clientId: 'client-id',
      allowedDomains: [],
      jitEnabled: false,
      autoLinkByEmail: false,
      isActive: false,
      ssoRequired: false,
      appRoleMappings: {},
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    const provider = new OidcProvider()
    await provider.validateConfig(config)
    await provider.validateConfig(config)

    expect(discovery).toHaveBeenCalledTimes(1)
  })

  test('shares cached discovery across request-scoped provider instances', async () => {
    const discovery = client.discovery as jest.MockedFunction<typeof client.discovery>
    discovery.mockResolvedValue({ serverMetadata: jest.fn() } as unknown as client.Configuration)
    const config = {
      id: 'cross-request-config-id',
      organizationId: 'organization-id',
      protocol: 'oidc',
      issuer: 'https://idp.example.com',
      clientId: 'client-id',
      allowedDomains: [],
      jitEnabled: false,
      autoLinkByEmail: false,
      isActive: false,
      ssoRequired: false,
      appRoleMappings: {},
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }

    await new OidcProvider().validateConfig(config)
    await new OidcProvider().validateConfig(config)

    expect(discovery).toHaveBeenCalledTimes(1)
  })
})

describe('OidcProvider discovery errors', () => {
  const config = {
    id: 'discovery-errors-config-id',
    organizationId: 'organization-id',
    protocol: 'oidc',
    issuer: 'https://10.0.0.5',
    clientId: 'client-id',
    allowedDomains: [],
    jitEnabled: false,
    autoLinkByEmail: false,
    isActive: false,
    ssoRequired: false,
    appRoleMappings: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }

  const guardError = () => new UnsafeOidcUrlError(
    'private_ip_resolved',
    'OIDC endpoint URL resolves to a private or reserved IP range',
  )

  test.each([0, 1, 3])('surfaces a URL-safety error through %i discovery wrappers', async (depth) => {
    let error: Error = guardError()
    for (let index = 0; index < depth; index += 1) {
      error = Object.assign(new Error('something went wrong'), { cause: error })
    }
    jest.mocked(client.discovery).mockRejectedValueOnce(error)

    expect(await new OidcProvider().validateConfig(config)).toEqual({
      ok: false,
      error: 'OIDC endpoint must resolve only to public IP addresses',
    })
  })

  test('does not expose an unrelated nested error', async () => {
    jest.mocked(client.discovery).mockRejectedValueOnce(Object.assign(
      new Error('something went wrong'),
      { cause: new Error('sensitive upstream detail') },
    ))

    expect(await new OidcProvider().validateConfig(config)).toEqual({
      ok: false,
      error: 'something went wrong',
    })
  })

  test('terminates on cyclic causes and preserves the outer error', async () => {
    const error = Object.assign(new Error('something went wrong'), { cause: null as unknown })
    error.cause = error
    jest.mocked(client.discovery).mockRejectedValueOnce(error)

    expect(await new OidcProvider().validateConfig(config)).toEqual({
      ok: false,
      error: 'something went wrong',
    })
  })

  test('preserves the fallback for a non-Error rejection', async () => {
    jest.mocked(client.discovery).mockRejectedValueOnce(null)

    expect(await new OidcProvider().validateConfig(config)).toEqual({
      ok: false,
      error: 'Discovery failed',
    })
  })
})

describe('OidcProvider discovery error disclosure', () => {
  const config = {
    id: 'error-disclosure-config',
    organizationId: 'organization-id',
    protocol: 'oidc',
    allowedDomains: [],
    jitEnabled: false,
    autoLinkByEmail: false,
    isActive: false,
    ssoRequired: false,
    appRoleMappings: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    issuer: 'https://idp.example.com',
    clientId: 'client-id',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  }
  const messages: Record<UrlSafetyReason, string> = {
    invalid_url: 'OIDC endpoint URL is invalid',
    forbidden_protocol: 'OIDC endpoint URL must use HTTPS',
    credentials_in_url: 'OIDC endpoint URL must not contain credentials',
    missing_host: 'OIDC endpoint URL must include a host',
    blocked_hostname: 'OIDC endpoint host is not allowed',
    private_ip_literal: 'OIDC endpoint must use a public IP address',
    private_ip_resolved: 'OIDC endpoint must resolve only to public IP addresses',
    dns_resolution_failed: 'OIDC endpoint DNS lookup failed; check the provider configuration',
    dns_resolution_empty: 'OIDC endpoint has no DNS address records; check the provider configuration',
  }

  async function validateError(error: unknown) {
    const discovery = client.discovery as jest.MockedFunction<typeof client.discovery>
    discovery.mockRejectedValueOnce(error)
    return new OidcProvider().validateConfig(config)
  }

  test('translates the fixed refusal without using resolver diagnostics', async () => {
    mockTranslate.mockReturnValueOnce('Wyszukiwanie DNS nie powiodło się')

    expect(await validateError(new UnsafeOidcUrlError(
      'dns_resolution_failed',
      'getaddrinfo ENOTFOUND private.internal',
    ))).toEqual({ ok: false, error: 'Wyszukiwanie DNS nie powiodło się' })
    expect(mockTranslate).toHaveBeenLastCalledWith(
      'sso.errors.oidc_url.dns_resolution_failed',
      messages.dns_resolution_failed,
    )
  })

  test.each(Object.entries(messages))('sanitizes direct and wrapped %s errors', async (reason, message) => {
    const unsafeError = new UnsafeOidcUrlError(
      reason as UrlSafetyReason,
      'idp.example.com resolved to 10.23.45.67: getaddrinfo EAI_AGAIN private-resolver',
    )
    for (const error of [unsafeError, new Error('discovery failed', { cause: unsafeError }),
      new Error('discovery failed', { cause: new Error('fetch failed', { cause: unsafeError }) })]) {
      expect(await validateError(error)).toEqual({ ok: false, error: message })
    }
  })

  test.each(['10.23.45.67', '127.0.0.1', '169.254.169.254', 'fd00::1234', '::1'])(
    'does not expose the private resolved address %s', async (address) => {
      const guardedFetch = createOidcFetch({
        privateOriginAllowlist: new Set(),
        lookupHost: async () => [{ address, family: address.includes(':') ? 6 : 4 }],
      })
      let rejection: unknown
      try {
        await guardedFetch(config.issuer, {
          body: undefined, headers: {}, method: 'GET', redirect: 'manual',
        })
      } catch (error) {
        rejection = error
      }
      expect(rejection).toBeInstanceOf(UnsafeOidcUrlError)
      expect(await validateError(new Error('fetch failed', { cause: rejection }))).toEqual({
        ok: false,
        error: messages.private_ip_resolved,
      })
    },
  )

  test.each(['getaddrinfo ENOTFOUND idp.example.com', 'queryA ECONNREFUSED 10.0.0.53'])(
    'does not expose DNS resolver diagnostics: %s', async (diagnostic) => {
      const guardedFetch = createOidcFetch({
        privateOriginAllowlist: new Set(),
        lookupHost: async () => { throw new Error(diagnostic) },
      })
      let rejection: unknown
      try {
        await guardedFetch(config.issuer, {
          body: undefined, headers: {}, method: 'GET', redirect: 'manual',
        })
      } catch (error) {
        rejection = error
      }
      expect(rejection).toBeInstanceOf(UnsafeOidcUrlError)
      expect(await validateError(new Error('fetch failed', { cause: rejection }))).toEqual({
        ok: false,
        error: messages.dns_resolution_failed,
      })
    },
  )

  test('preserves the outer message for unrelated errors', async () => {
    expect(await validateError(new Error('Discovery unavailable', {
      cause: new Error('Internal diagnostic'),
    }))).toEqual({ ok: false, error: 'Discovery unavailable' })
    expect(await validateError('rejected')).toEqual({ ok: false, error: 'Discovery failed' })
  })

  test('bounds cause traversal and terminates for cycles', async () => {
    const cyclicError = new Error('Cyclic discovery failure')
    Object.assign(cyclicError, { cause: cyclicError })
    expect(await validateError(cyclicError)).toEqual({ ok: false, error: cyclicError.message })

    let nestedError: Error = new UnsafeOidcUrlError('private_ip_resolved', '10.23.45.67')
    for (let depth = 0; depth < 9; depth += 1) {
      nestedError = new Error('Discovery wrapper', { cause: nestedError })
    }
    expect(await validateError(nestedError)).toEqual({ ok: false, error: messages.private_ip_resolved })
    expect(await validateError(new Error('Outside traversal bound', { cause: nestedError }))).toEqual({
      ok: false, error: 'Outside traversal bound',
    })
  })
})

describe('normalizeEmailVerifiedClaim', () => {
  test('preserves explicit true', () => {
    expect(normalizeEmailVerifiedClaim(true)).toBe(true)
  })

  test('preserves explicit false', () => {
    expect(normalizeEmailVerifiedClaim(false)).toBe(false)
  })

  test('returns undefined when the claim is missing (Microsoft Entra ID case)', () => {
    expect(normalizeEmailVerifiedClaim(undefined)).toBeUndefined()
  })

  test('returns undefined for null', () => {
    expect(normalizeEmailVerifiedClaim(null)).toBeUndefined()
  })

  test('returns undefined for non-boolean string values (does not coerce "true")', () => {
    expect(normalizeEmailVerifiedClaim('true')).toBeUndefined()
    expect(normalizeEmailVerifiedClaim('false')).toBeUndefined()
  })

  test('returns undefined for numeric values', () => {
    expect(normalizeEmailVerifiedClaim(1)).toBeUndefined()
    expect(normalizeEmailVerifiedClaim(0)).toBeUndefined()
  })
})

describe('coerceClaimValues', () => {
  test('returns empty array for null', () => {
    expect(coerceClaimValues(null)).toEqual([])
  })

  test('returns empty array for undefined', () => {
    expect(coerceClaimValues(undefined)).toEqual([])
  })

  test('returns empty array for number', () => {
    expect(coerceClaimValues(42)).toEqual([])
  })

  test('returns empty array for boolean', () => {
    expect(coerceClaimValues(true)).toEqual([])
  })

  test('wraps a non-empty string in an array', () => {
    expect(coerceClaimValues('admin')).toEqual(['admin'])
  })

  test('trims whitespace from string values', () => {
    expect(coerceClaimValues('  admin  ')).toEqual(['admin'])
  })

  test('returns empty array for whitespace-only string', () => {
    expect(coerceClaimValues('   ')).toEqual([])
  })

  test('returns empty array for empty string', () => {
    expect(coerceClaimValues('')).toEqual([])
  })

  test('flattens a simple string array', () => {
    expect(coerceClaimValues(['admin', 'editor'])).toEqual(['admin', 'editor'])
  })

  test('flattens nested arrays recursively', () => {
    expect(coerceClaimValues([['admin'], [['editor', 'viewer']]])).toEqual([
      'admin',
      'editor',
      'viewer',
    ])
  })

  test('filters out non-string entries from arrays', () => {
    expect(coerceClaimValues(['admin', 42, null, 'editor'])).toEqual(['admin', 'editor'])
  })

  test('extracts keys and string values from objects', () => {
    const result = coerceClaimValues({ groupA: 'Admin', groupB: 'Editor' })
    expect(result).toContain('groupA')
    expect(result).toContain('Admin')
    expect(result).toContain('groupB')
    expect(result).toContain('Editor')
  })

  test('extracts only keys when values are non-string', () => {
    const result = coerceClaimValues({ groupA: 123, groupB: true })
    expect(result).toEqual(['groupA', 'groupB'])
  })

  test('extracts name property from nested objects', () => {
    const result = coerceClaimValues({
      '001': { name: 'Administrators' },
      '002': { name: 'Editors' },
    })
    expect(result).toContain('001')
    expect(result).toContain('Administrators')
    expect(result).toContain('002')
    expect(result).toContain('Editors')
  })

  test('ignores nested objects without a name property', () => {
    const result = coerceClaimValues({ '001': { id: 'abc' } })
    expect(result).toEqual(['001'])
  })

  test('trims keys and nested name values', () => {
    const result = coerceClaimValues({ ' key ': { name: ' value ' } })
    expect(result).toContain('key')
    expect(result).toContain('value')
  })

  test('skips empty keys after trimming', () => {
    const result = coerceClaimValues({ '  ': 'admin' })
    expect(result).toContain('admin')
    expect(result).not.toContain('')
  })
})

describe('extractIdentityGroups', () => {
  test('returns undefined when no group claims are present', () => {
    expect(extractIdentityGroups({ sub: '123', email: 'a@b.com' })).toBeUndefined()
  })

  test('returns undefined for empty claims', () => {
    expect(extractIdentityGroups({})).toBeUndefined()
  })

  test('extracts groups from "groups" claim (array of strings)', () => {
    const result = extractIdentityGroups({ groups: ['admin', 'viewer'] })
    expect(result).toEqual(['admin', 'viewer'])
  })

  test('extracts groups from "roles" claim', () => {
    const result = extractIdentityGroups({ roles: ['manager'] })
    expect(result).toEqual(['manager'])
  })

  test('extracts groups from "role" claim (singular string)', () => {
    const result = extractIdentityGroups({ role: 'superadmin' })
    expect(result).toEqual(['superadmin'])
  })

  test('extracts groups from keys ending with ":roles"', () => {
    const result = extractIdentityGroups({
      'http://schemas.example.com/ws/2024:roles': ['custom-role'],
    })
    expect(result).toEqual(['custom-role'])
  })

  test('ignores keys that contain but do not end with ":roles"', () => {
    const result = extractIdentityGroups({
      ':roles:extra': ['should-ignore'],
    })
    expect(result).toBeUndefined()
  })

  test('deduplicates groups across multiple claims', () => {
    const result = extractIdentityGroups({
      groups: ['admin', 'editor'],
      roles: ['admin', 'viewer'],
      role: 'editor',
    })
    expect(result).toBeDefined()
    expect(new Set(result)).toEqual(new Set(['admin', 'editor', 'viewer']))
    expect(result!.length).toBe(3)
  })

  test('handles object-type claims with name property', () => {
    const result = extractIdentityGroups({
      groups: { '001': { name: 'Admins' } },
    })
    expect(result).toContain('001')
    expect(result).toContain('Admins')
  })

  test('handles mixed types across claims', () => {
    const result = extractIdentityGroups({
      groups: ['group-a'],
      roles: 'single-role',
      'custom:roles': { id1: 'RoleName' },
    })
    expect(result).toBeDefined()
    expect(result).toContain('group-a')
    expect(result).toContain('single-role')
    expect(result).toContain('id1')
    expect(result).toContain('RoleName')
  })

  test('returns undefined when all group claims resolve to empty', () => {
    const result = extractIdentityGroups({
      groups: [],
      roles: [],
      role: '',
    })
    expect(result).toBeUndefined()
  })

  test('handles groups claim as a single string', () => {
    const result = extractIdentityGroups({ groups: 'solo-group' })
    expect(result).toEqual(['solo-group'])
  })
})
