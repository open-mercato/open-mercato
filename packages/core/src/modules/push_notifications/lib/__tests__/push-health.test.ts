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

  it('delegates to the config probe when fake providers are disabled', async () => {
    delete process.env[PUSH_FAKE_PROVIDERS_ENV]
    const health = makePushClientConfigHealthCheck({ schema, providerLabel: 'FCM' })
    expect((await health.check({ token: 'valid' }, scope)).status).toBe('healthy')
    expect((await health.check({}, scope)).status).toBe('unhealthy')
  })
})
