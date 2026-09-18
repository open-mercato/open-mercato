import { setup } from '../setup'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TENANT_ID = '10000000-0000-4000-8000-000000000001'
const ORGANIZATION_ID = '20000000-0000-4000-8000-000000000001'

function makeContainer(hasScheduler = true) {
  const register = jest.fn().mockResolvedValue(undefined)
  const resolve = jest.fn((name: string) => {
    if (name !== 'schedulerService') throw new Error(`unexpected registration: ${name}`)
    return { register }
  })
  return {
    register,
    resolve,
    container: {
      hasRegistration: (name: string) => hasScheduler && name === 'schedulerService',
      resolve,
    },
  }
}

describe('payment_gateways setup schedules', () => {
  it('registers a stable organization-scoped daily retention schedule', async () => {
    const { container, register } = makeContainer()
    const context = { container, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID } as never

    await setup.seedDefaults?.(context)
    await setup.seedDefaults?.(context)

    expect(register).toHaveBeenCalledTimes(2)
    const first = register.mock.calls[0]?.[0] as Record<string, unknown>
    const second = register.mock.calls[1]?.[0] as Record<string, unknown>
    expect(first.id).toBe(second.id)
    expect(UUID_RE.test(first.id as string)).toBe(true)
    expect(first).toMatchObject({
      scopeType: 'organization',
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      scheduleType: 'interval',
      scheduleValue: '24h',
      timezone: 'UTC',
      targetType: 'queue',
      targetQueue: 'payment-gateway-session-initialization-prune',
      targetPayload: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      sourceType: 'module',
      sourceModule: 'payment_gateways',
      isEnabled: true,
    })
  })

  it('keeps tenant setup working when the optional scheduler is unavailable', async () => {
    const { container, register, resolve } = makeContainer(false)

    await setup.seedDefaults?.({
      container,
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    } as never)

    expect(resolve).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })
})
