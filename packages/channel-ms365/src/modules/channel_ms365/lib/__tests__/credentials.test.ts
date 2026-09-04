import {
  MS365_DEFAULT_SCOPES,
  MS365_DEFAULT_TENANT,
  ms365ChannelStateSchema,
  ms365ClientCredentialsSchema,
  ms365UserCredentialsSchema,
  parseScopes,
} from '../credentials'

describe('ms365ClientCredentialsSchema', () => {
  it('defaults tenantId to organizations when blank or missing', () => {
    expect(ms365ClientCredentialsSchema.parse({ clientId: 'cid', clientSecret: 'sec' }).tenantId).toBe(MS365_DEFAULT_TENANT)
    expect(ms365ClientCredentialsSchema.parse({ clientId: 'cid', clientSecret: 'sec', tenantId: '   ' }).tenantId).toBe('organizations')
  })

  it('accepts a directory GUID, a verified domain, and the common alias', () => {
    for (const tenantId of ['0f3a1c2e-1111-2222-3333-444455556666', 'contoso.onmicrosoft.com', 'common', 'consumers']) {
      expect(ms365ClientCredentialsSchema.parse({ clientId: 'cid', clientSecret: 'sec', tenantId }).tenantId).toBe(tenantId)
    }
  })

  it('rejects tenant ids that could break out of the authority URL', () => {
    expect(() => ms365ClientCredentialsSchema.parse({ clientId: 'cid', clientSecret: 'sec', tenantId: 'evil/../x' })).toThrow(/Tenant ID/)
    expect(() => ms365ClientCredentialsSchema.parse({ clientId: 'cid', clientSecret: 'sec', tenantId: 'a b' })).toThrow(/Tenant ID/)
  })

  it('requires clientId and clientSecret and rejects unknown keys', () => {
    expect(() => ms365ClientCredentialsSchema.parse({ clientSecret: 'sec' })).toThrow(/Client ID/)
    expect(() => ms365ClientCredentialsSchema.parse({ clientId: 'cid' })).toThrow(/Client Secret/)
    expect(() => ms365ClientCredentialsSchema.parse({ clientId: 'cid', clientSecret: 'sec', extra: 1 })).toThrow()
  })
})

describe('parseScopes', () => {
  it('returns the defaults for a blank override', () => {
    expect(parseScopes(undefined)).toEqual(MS365_DEFAULT_SCOPES)
    expect(parseScopes('   ')).toEqual(MS365_DEFAULT_SCOPES)
  })

  it('splits on commas/whitespace, dedups, and always re-adds offline_access', () => {
    const scopes = parseScopes('https://graph.microsoft.com/Mail.Read, openid,openid  email')
    expect(scopes[0]).toBe('offline_access')
    expect(scopes).toEqual(['offline_access', 'https://graph.microsoft.com/Mail.Read', 'openid', 'email'])
  })

  it('keeps an explicit offline_access where the admin placed it', () => {
    expect(parseScopes('openid offline_access Mail.Send')).toEqual(['openid', 'offline_access', 'Mail.Send'])
  })
})

describe('ms365UserCredentialsSchema', () => {
  it('requires an access token and passes extra keys through', () => {
    expect(() => ms365UserCredentialsSchema.parse({})).toThrow(/Access token/)
    const parsed = ms365UserCredentialsSchema.parse({ accessToken: 'a', userId: 'u1', email: 'Alice@Contoso.com' })
    expect((parsed as Record<string, unknown>).userId).toBe('u1')
  })

  it('rejects a malformed expiry', () => {
    expect(() => ms365UserCredentialsSchema.parse({ accessToken: 'a', expiresAt: 'soon' })).toThrow()
  })
})

describe('ms365ChannelStateSchema', () => {
  it('accepts an empty state and a full cursor', () => {
    expect(ms365ChannelStateSchema.parse({})).toEqual({})
    const state = ms365ChannelStateSchema.parse({
      deltaLink: 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=x',
      receivedWatermark: '2026-09-04T10:00:00.000Z',
      lastSyncedAt: '2026-09-04T10:05:00.000Z',
      pushStatus: 'inactive',
    })
    expect(state.deltaLink).toContain('$deltatoken')
    expect((state as Record<string, unknown>).pushStatus).toBe('inactive')
  })
})
