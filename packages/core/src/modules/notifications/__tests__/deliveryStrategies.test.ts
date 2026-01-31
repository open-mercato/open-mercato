import { type NotificationDeliveryStrategy } from '../lib/deliveryStrategies'

describe('notification delivery strategies', () => {
  it('orders strategies by priority', async () => {
    jest.resetModules()
    const { registerNotificationDeliveryStrategy, getNotificationDeliveryStrategies } = await import('../lib/deliveryStrategies')

    const first: NotificationDeliveryStrategy = { id: 'first', deliver: jest.fn() }
    const second: NotificationDeliveryStrategy = { id: 'second', deliver: jest.fn() }
    const third: NotificationDeliveryStrategy = { id: 'third', deliver: jest.fn() }

    registerNotificationDeliveryStrategy(first, { priority: 1 })
    registerNotificationDeliveryStrategy(second, { priority: 10 })
    registerNotificationDeliveryStrategy(third, { priority: 5 })

    const ids = getNotificationDeliveryStrategies().map((strategy) => strategy.id)
    expect(ids).toEqual(['second', 'third', 'first'])
  })
})
