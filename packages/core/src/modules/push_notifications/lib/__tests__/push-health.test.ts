import { z } from 'zod'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { makePushClientConfigHealthCheck } from '../push-health'
import { PUSH_FAKE_PROVIDERS_ENV } from '../fake-provider-recorder'

const scope: IntegrationScope = { tenantId: 't1', organizationId: 'o1' }
const schema = z.object({ token: z.string().min(1) })

describe('makePushClientConfigHealthCheck', () => {
  const original = process.env[PUSH_FAKE_PROVIDERS_ENV]
  afterEach(() => {
    if (original === undefined) delete process.env[PUSH_FAKE_PROVIDERS_ENV]
    else process.env[PUSH_FAKE_PROVIDERS_ENV] = original
  })

  it('reports degraded when fake providers are enabled, regardless of credentials', async () => {
    process.env[PUSH_FAKE_PROVIDERS_ENV] = '1'
    const health = makePushClientConfigHealthCheck({ schema, providerLabel: 'Expo' })
    const result = await health.check({ token: 'valid' }, scope)
    expect(result.status).toBe('degraded')
    expect(result.details).toMatchObject({ fakeProviders: true })
    expect(result.message).toContain('FAKE mode')
  })

  it('validates credentials with push-appropriate copy when fake providers are disabled', async () => {
    delete process.env[PUSH_FAKE_PROVIDERS_ENV]
    const health = makePushClientConfigHealthCheck({ schema, providerLabel: 'FCM' })

    const healthy = await health.check({ token: 'valid' }, scope)
    expect(healthy.status).toBe('healthy')
    expect(healthy.message).toBe('FCM credentials configured')
    expect(healthy.details).toMatchObject({ credentialsConfigured: true })

    const unhealthy = await health.check({}, scope)
    expect(unhealthy.status).toBe('unhealthy')
    // Push providers have no OAuth client — the copy must not claim one.
    expect(unhealthy.message).toContain('credentials invalid')
    expect(unhealthy.message).not.toContain('OAuth')
    expect(unhealthy.details).toMatchObject({ reason: 'invalid_credentials' })
  })
})
