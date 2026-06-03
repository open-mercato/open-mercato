import { resolveOAuthClientCredentials } from '../oauth-client-config'

describe('resolveOAuthClientCredentials', () => {
  it('returns null when no credentials service is available', async () => {
    expect(
      await resolveOAuthClientCredentials(null, 'gmail', { tenantId: 't1', organizationId: 'o1' }),
    ).toBeNull()
    expect(
      await resolveOAuthClientCredentials(undefined, 'gmail', { tenantId: 't1', organizationId: 'o1' }),
    ).toBeNull()
  })

  it('resolves the channel_<provider> row at tenant scope (userId = null)', async () => {
    // The client app config lives under `channel_<provider>` at userId=null —
    // the SAME row the admin edits in the Integrations UI. (Earlier code read a
    // phantom `oauth_<provider>` id, which is why connect/refresh failed.)
    const resolve = jest.fn(async (id: string, scope: { organizationId: string | null; userId?: string | null }) => {
      if (id === 'channel_gmail' && scope.userId === null && scope.organizationId === 'o1') {
        return { clientId: 'cid', clientSecret: 'secret' }
      }
      return null
    })
    const result = await resolveOAuthClientCredentials({ resolve }, 'gmail', {
      tenantId: 't1',
      organizationId: 'o1',
    })
    expect(result).toEqual({ clientId: 'cid', clientSecret: 'secret' })
    expect(resolve).toHaveBeenCalledWith('channel_gmail', {
      tenantId: 't1',
      organizationId: 'o1',
      userId: null,
    })
  })

  it('falls back to the organization-agnostic row (organizationId = null)', async () => {
    const resolve = jest.fn(async (id: string, scope: { organizationId: string | null }) => {
      if (id === 'channel_gmail' && scope.organizationId === null) return { clientId: 'cid' }
      return null // org-specific row absent
    })
    const result = await resolveOAuthClientCredentials({ resolve }, 'gmail', {
      tenantId: 't1',
      organizationId: 'o1',
    })
    expect(result).toEqual({ clientId: 'cid' })
    expect(resolve).toHaveBeenNthCalledWith(1, 'channel_gmail', {
      tenantId: 't1',
      organizationId: 'o1',
      userId: null,
    })
    expect(resolve).toHaveBeenNthCalledWith(2, 'channel_gmail', {
      tenantId: 't1',
      organizationId: null,
      userId: null,
    })
  })

  it('returns null when the resolved row has no clientId (e.g. only a per-user token blob)', async () => {
    const resolve = jest.fn(async () => ({ accessToken: 'tok', refreshToken: 'r' }))
    expect(
      await resolveOAuthClientCredentials({ resolve }, 'gmail', { tenantId: 't1', organizationId: 'o1' }),
    ).toBeNull()
  })

  it('returns null and swallows resolve errors', async () => {
    const resolve = jest.fn(async () => {
      throw new Error('db down')
    })
    expect(
      await resolveOAuthClientCredentials({ resolve }, 'gmail', { tenantId: 't1', organizationId: 'o1' }),
    ).toBeNull()
  })

  it('does not resolve the same organization twice when org is already null', async () => {
    const resolve = jest.fn(async () => null)
    await resolveOAuthClientCredentials({ resolve }, 'gmail', { tenantId: 't1', organizationId: null })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith('channel_gmail', {
      tenantId: 't1',
      organizationId: null,
      userId: null,
    })
  })
})
