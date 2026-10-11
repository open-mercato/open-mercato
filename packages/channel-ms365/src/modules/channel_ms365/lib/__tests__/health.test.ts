import { channelMs365HealthCheck } from '../health'

const scope = { tenantId: 't', organizationId: 'o' } as never

describe('channelMs365HealthCheck', () => {
  it('reports healthy for a well-formed client config and echoes the tenant', async () => {
    const result = await channelMs365HealthCheck.check({ clientId: 'cid', clientSecret: 'sec', tenantId: 'contoso.onmicrosoft.com' }, scope)
    expect(result.status).toBe('healthy')
    expect(result.details).toMatchObject({ clientIdConfigured: true, tenantId: 'contoso.onmicrosoft.com' })
  })

  it('defaults the tenant to organizations when the admin left it blank', async () => {
    const result = await channelMs365HealthCheck.check({ clientId: 'cid', clientSecret: 'sec', tenantId: '' }, scope)
    expect(result.status).toBe('healthy')
    expect(result.details).toMatchObject({ tenantId: 'organizations' })
  })

  it('reports unhealthy when the client config is missing', async () => {
    const result = await channelMs365HealthCheck.check(null, scope)
    expect(result.status).toBe('unhealthy')
    expect(result.details).toMatchObject({ reason: 'invalid_oauth_client' })
    expect(result.message).toContain('Microsoft 365')
  })
})
