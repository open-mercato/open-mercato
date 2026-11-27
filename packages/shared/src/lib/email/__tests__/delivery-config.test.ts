import {
  DEFAULT_EMAIL_DELIVERY_MAX_HOURS,
  DEFAULT_EMAIL_DELIVERY_RETRY_DELAY_SECONDS,
  getEmailDeliveryMaxHours,
  getEmailDeliveryRetryDelaySeconds,
} from '../delivery-config'

describe('email delivery config', () => {
  const original = { ...process.env }

  afterEach(() => {
    process.env = { ...original }
  })

  it('falls back to the defaults when unset', () => {
    delete process.env.OM_EMAIL_DELIVERY_MAX_HOURS
    delete process.env.OM_EMAIL_DELIVERY_RETRY_DELAY_SECONDS
    expect(getEmailDeliveryMaxHours()).toBe(DEFAULT_EMAIL_DELIVERY_MAX_HOURS)
    expect(getEmailDeliveryRetryDelaySeconds()).toBe(DEFAULT_EMAIL_DELIVERY_RETRY_DELAY_SECONDS)
  })

  it('reads positive integers at call time', () => {
    process.env.OM_EMAIL_DELIVERY_MAX_HOURS = '48'
    process.env.OM_EMAIL_DELIVERY_RETRY_DELAY_SECONDS = ' 60 '
    expect(getEmailDeliveryMaxHours()).toBe(48)
    expect(getEmailDeliveryRetryDelaySeconds()).toBe(60)
  })

  it.each(['0', '-5', '1.5', 'abc', ''])('rejects %p and uses the default', (value) => {
    process.env.OM_EMAIL_DELIVERY_MAX_HOURS = value
    process.env.OM_EMAIL_DELIVERY_RETRY_DELAY_SECONDS = value
    expect(getEmailDeliveryMaxHours()).toBe(DEFAULT_EMAIL_DELIVERY_MAX_HOURS)
    expect(getEmailDeliveryRetryDelaySeconds()).toBe(DEFAULT_EMAIL_DELIVERY_RETRY_DELAY_SECONDS)
  })
})
