import {
  resetSystemEmailDeliveryModeWarningForTests,
  resolveConfiguredSystemEmailDeliveryMode,
  resolveSystemEmailDeliveryMode,
} from '../system-email-delivery-mode'

const basePayload = {
  to: 'user@example.com',
  subject: 'Hello',
  from: 'from@example.com',
  text: 'Hello',
}

describe('system email delivery mode', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.OM_SYSTEM_EMAIL_DELIVERY
    resetSystemEmailDeliveryModeWarningForTests()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('defaults to synchronous delivery', () => {
    expect(resolveConfiguredSystemEmailDeliveryMode()).toBe('sync')
    expect(resolveSystemEmailDeliveryMode({ ...basePayload, tenantId: 'tenant-1' })).toBe('sync')
  })

  it('reads queued mode from the environment, case-insensitively', () => {
    process.env.OM_SYSTEM_EMAIL_DELIVERY = ' Queued '
    expect(resolveConfiguredSystemEmailDeliveryMode()).toBe('queued')
  })

  it('falls back to synchronous delivery for an unknown value', () => {
    process.env.OM_SYSTEM_EMAIL_DELIVERY = 'later'
    expect(resolveConfiguredSystemEmailDeliveryMode()).toBe('sync')
  })

  it('lets a per-call option override the instance default', () => {
    process.env.OM_SYSTEM_EMAIL_DELIVERY = 'queued'
    expect(resolveSystemEmailDeliveryMode({ ...basePayload, tenantId: 'tenant-1', delivery: 'sync' })).toBe('sync')
    delete process.env.OM_SYSTEM_EMAIL_DELIVERY
    expect(resolveSystemEmailDeliveryMode({ ...basePayload, tenantId: 'tenant-1', delivery: 'queued' })).toBe('queued')
  })

  it('always delivers tenantless email synchronously', () => {
    process.env.OM_SYSTEM_EMAIL_DELIVERY = 'queued'
    expect(resolveSystemEmailDeliveryMode(basePayload)).toBe('sync')
    expect(resolveSystemEmailDeliveryMode({ ...basePayload, delivery: 'queued' })).toBe('sync')
  })
})
