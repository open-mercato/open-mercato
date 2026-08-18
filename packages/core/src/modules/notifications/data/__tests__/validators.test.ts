import { updateNotificationTypeSchema } from '../validators'

describe('updateNotificationTypeSchema — channels black-hole guard', () => {
  it('accepts a non-empty channels array', () => {
    const parsed = updateNotificationTypeSchema.safeParse({ id: 'orders.shipped', channels: ['in_app', 'email'] })
    expect(parsed.success).toBe(true)
  })

  it('accepts null channels (clears the override so the code default reapplies)', () => {
    const parsed = updateNotificationTypeSchema.safeParse({ id: 'orders.shipped', channels: null })
    expect(parsed.success).toBe(true)
  })

  it('rejects an empty channels array (would black-hole the type — clear with null instead)', () => {
    const parsed = updateNotificationTypeSchema.safeParse({ id: 'orders.shipped', channels: [] })
    expect(parsed.success).toBe(false)
  })

  it('still requires at least one of channels or nonOptOut', () => {
    const parsed = updateNotificationTypeSchema.safeParse({ id: 'orders.shipped' })
    expect(parsed.success).toBe(false)
  })
})
