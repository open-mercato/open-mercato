import { channelGmailHealthCheck } from '../health'

const scope = { tenantId: 'tenant', organizationId: 'organization' }
const credentials = { clientId: 'fixture-client-id', clientSecret: 'fixture-client-secret' }

describe('channelGmailHealthCheck', () => {
  afterEach(() => jest.restoreAllMocks())

  it('reports missing OAuth state configuration without exposing credentials', async () => {
    jest.replaceProperty(process, 'env', { NODE_ENV: 'production', JWT_SECRET: 'fixture-session-key' })

    await expect(channelGmailHealthCheck.check(credentials, scope)).resolves.toEqual({
      status: 'unhealthy',
      message: 'Gmail OAuth state secret is not configured',
      details: { reason: 'missing_oauth_state_secret' },
    })
  })

  it('keeps the state cookie unavailable when an explicitly empty dedicated key overrides KMS', async () => {
    jest.replaceProperty(process, 'env', {
      NODE_ENV: 'production',
      OM_HUB_OAUTH_STATE_KEY: '',
      KMS_MASTER_KEY: 'fixture-kms-key',
    })

    await expect(channelGmailHealthCheck.check(credentials, scope)).resolves.toMatchObject({
      status: 'unhealthy',
      details: { reason: 'missing_oauth_state_secret' },
    })
  })

  it.each<NodeJS.ProcessEnv>([
    { NODE_ENV: 'production', OM_HUB_OAUTH_STATE_KEY: 'fixture-state-key' },
    { NODE_ENV: 'production', KMS_MASTER_KEY: 'fixture-kms-key' },
    { NODE_ENV: 'test', JWT_SECRET: 'fixture-session-key' },
  ])('accepts a state secret that the hub can resolve', async (env) => {
    jest.replaceProperty(process, 'env', env)

    await expect(channelGmailHealthCheck.check(credentials, scope)).resolves.toEqual({
      status: 'healthy',
      message: 'Gmail OAuth client configured',
      details: { clientIdConfigured: true },
    })
  })

  it('keeps invalid client configuration distinct from missing state configuration', async () => {
    jest.replaceProperty(process, 'env', { NODE_ENV: 'production' })

    await expect(channelGmailHealthCheck.check(null, scope)).resolves.toMatchObject({
      status: 'unhealthy',
      details: { reason: 'invalid_oauth_client' },
    })
  })
})
