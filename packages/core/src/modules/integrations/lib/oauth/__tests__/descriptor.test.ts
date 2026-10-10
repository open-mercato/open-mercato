/** @jest-environment node */
import {
  OAuthDescriptorError,
  OAuthGrantError,
  oauthProviderDescriptorSchema,
  resolveOAuthProviderDescriptor,
  type OAuthGrantOwner,
  type OAuthProviderDescriptor,
} from '../descriptor'

const ENV_KEYS = ['NODE_ENV', 'OM_ENABLE_TEST_OAUTH_GRANTS'] as const
const originalEnv: Record<string, string | undefined> = {}

const descriptor: OAuthProviderDescriptor = {
  integrationId: 'acme_mail',
  authorizationEndpoint: 'https://auth.acme.test/oauth/authorize',
  tokenEndpoint: 'https://auth.acme.test/oauth/token',
  defaultScopes: ['mail.read', 'offline_access'],
}

const owner: OAuthGrantOwner = { integrationId: 'acme_mail', tenantId: 'tenant-1', organizationId: 'org-1' }

function fieldOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof OAuthDescriptorError) {
      expect(error).toBeInstanceOf(TypeError)
      expect(error.message.startsWith('[internal]')).toBe(true)
      return error.field
    }
    throw error
  }
  throw new Error('[internal] expected OAuthDescriptorError')
}

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key]
  delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

describe('resolveOAuthProviderDescriptor', () => {
  it('applies the defaults', () => {
    expect(resolveOAuthProviderDescriptor(descriptor, owner)).toEqual({
      ...descriptor,
      revocationEndpoint: undefined,
      clientAuthMethod: 'client_secret_basic',
      pkce: 'S256',
      extraAuthorizeParams: {},
      requiresRefreshToken: true,
      defaultAccessTokenTtlSec: 3600,
      refreshSkewMs: 120_000,
      onAfterDisconnect: undefined,
    })
  })

  it('keeps explicit values and the hook', () => {
    const onAfterDisconnect = jest.fn(async () => undefined)
    const resolved = resolveOAuthProviderDescriptor({
      ...descriptor,
      revocationEndpoint: 'https://auth.acme.test/oauth/revoke',
      clientAuthMethod: 'client_secret_post',
      pkce: 'none',
      extraAuthorizeParams: { access_type: 'offline' },
      requiresRefreshToken: false,
      defaultAccessTokenTtlSec: 600,
      refreshSkewMs: 30_000,
      onAfterDisconnect,
    })

    expect(resolved).toMatchObject({
      revocationEndpoint: 'https://auth.acme.test/oauth/revoke',
      clientAuthMethod: 'client_secret_post',
      pkce: 'none',
      extraAuthorizeParams: { access_type: 'offline' },
      requiresRefreshToken: false,
      defaultAccessTokenTtlSec: 600,
      refreshSkewMs: 30_000,
    })
    expect(resolved.onAfterDisconnect).toBe(onAfterDisconnect)
  })

  it.each([
    ['a non-object', null, 'descriptor'],
    ['a missing integrationId', { ...descriptor, integrationId: undefined }, 'integrationId'],
    ['a relative endpoint', { ...descriptor, tokenEndpoint: '/oauth/token' }, 'tokenEndpoint'],
    ['a non-loopback http endpoint', { ...descriptor, tokenEndpoint: 'http://auth.acme.test/token' }, 'tokenEndpoint'],
    ['an endpoint with credentials', { ...descriptor, authorizationEndpoint: 'https://user:pw@auth.acme.test/a' }, 'authorizationEndpoint'],
    ['an endpoint with a fragment', { ...descriptor, revocationEndpoint: 'https://auth.acme.test/revoke#x' }, 'revocationEndpoint'],
    ['empty default scopes', { ...descriptor, defaultScopes: [] }, 'defaultScopes'],
    ['a scope with whitespace', { ...descriptor, defaultScopes: ['mail.read offline_access'] }, 'defaultScopes.0'],
    ['an unknown auth method', { ...descriptor, clientAuthMethod: 'private_key_jwt' }, 'clientAuthMethod'],
    ['an unknown PKCE mode', { ...descriptor, pkce: 'plain' }, 'pkce'],
    ['a fractional TTL', { ...descriptor, defaultAccessTokenTtlSec: 1.5 }, 'defaultAccessTokenTtlSec'],
    ['a zero skew', { ...descriptor, refreshSkewMs: 0 }, 'refreshSkewMs'],
    ['a non-string authorize param', { ...descriptor, extraAuthorizeParams: { prompt: 1 } }, 'extraAuthorizeParams.prompt'],
    ['a non-function hook', { ...descriptor, onAfterDisconnect: 'later' }, 'onAfterDisconnect'],
    ['an unknown key', { ...descriptor, tokenUrl: 'https://auth.acme.test/token' }, 'tokenUrl'],
  ])('rejects %s', (_label, input, field) => {
    expect(fieldOf(() => resolveOAuthProviderDescriptor(input, owner))).toBe(field)
    expect(oauthProviderDescriptorSchema.safeParse(input).success).toBe(false)
  })

  it.each([
    ['another integration', { ...owner, integrationId: 'other_mail' }, 'integrationId'],
    ['an empty organization', { ...owner, organizationId: '' }, 'owner.organizationId'],
    ['an empty tenant', { ...owner, tenantId: '' }, 'owner.tenantId'],
    ['a per-user owner', { ...owner, userId: 'user-1' }, 'owner.userId'],
  ])('rejects an owner from %s', (_label, input, field) => {
    expect(fieldOf(() => resolveOAuthProviderDescriptor(descriptor, input as OAuthGrantOwner))).toBe(field)
  })

  it('accepts an owner with an explicit null userId', () => {
    expect(() => resolveOAuthProviderDescriptor(descriptor, { ...owner, userId: null })).not.toThrow()
  })

  describe('loopback http endpoints', () => {
    const loopback = {
      ...descriptor,
      authorizationEndpoint: 'http://127.0.0.1:4100/authorize',
      tokenEndpoint: 'http://localhost:4100/token',
      revocationEndpoint: 'http://[::1]:4100/revoke',
    }

    it('are accepted outside production', () => {
      process.env.NODE_ENV = 'test'
      expect(() => resolveOAuthProviderDescriptor(loopback)).not.toThrow()
    })

    it('are rejected in production', () => {
      process.env.NODE_ENV = 'production'
      expect(fieldOf(() => resolveOAuthProviderDescriptor(loopback))).toBe('authorizationEndpoint')
    })

    it('are accepted in production when OM_ENABLE_TEST_OAUTH_GRANTS is on', () => {
      process.env.NODE_ENV = 'production'
      process.env.OM_ENABLE_TEST_OAUTH_GRANTS = 'true'
      expect(() => resolveOAuthProviderDescriptor(loopback)).not.toThrow()
    })

    it('stay rejected in production when OM_ENABLE_TEST_OAUTH_GRANTS is off', () => {
      process.env.NODE_ENV = 'production'
      process.env.OM_ENABLE_TEST_OAUTH_GRANTS = 'false'
      expect(fieldOf(() => resolveOAuthProviderDescriptor(loopback))).toBe('authorizationEndpoint')
    })
  })
})

describe('OAuthGrantError', () => {
  it('carries code, reason and provider code with an [internal] message', () => {
    const error = new OAuthGrantError('client_misconfigured', { reason: 'token_endpoint_rejected', providerErrorCode: 'invalid_scope' })

    expect(error).toMatchObject({ code: 'client_misconfigured', reason: 'token_endpoint_rejected', providerErrorCode: 'invalid_scope' })
    expect(error.message).toBe('[internal] OAuth grant operation failed: client_misconfigured (token_endpoint_rejected)')
    expect(new OAuthGrantError('not_connected')).toMatchObject({ reason: null, providerErrorCode: null })
  })
})
