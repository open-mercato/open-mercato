import type { NotificationChannelDefinition } from '@open-mercato/shared/modules/notifications/types'
import {
  getNotificationChannel,
  getNotificationChannels,
  registerNotificationChannelEntries,
  registerNotificationChannels,
} from '../notification-channel-registry'

function chan(id: string, extra: Partial<NotificationChannelDefinition> = {}): NotificationChannelDefinition {
  return { id, labelKey: `channels.${id}`, ...extra }
}

describe('notification-channel-registry', () => {
  beforeEach(() => {
    registerNotificationChannels([], { replace: true })
  })

  it('registers and looks up channels by id', () => {
    registerNotificationChannels([chan('in_app'), chan('push')])
    expect(getNotificationChannel('in_app')?.labelKey).toBe('channels.in_app')
    expect(getNotificationChannel('missing')).toBeUndefined()
  })

  it('sorts by order then id', () => {
    registerNotificationChannels([
      chan('push', { order: 30 }),
      chan('in_app', { order: 10 }),
      chan('email', { order: 20 }),
      chan('sms'),
      chan('carrier_pigeon'),
    ])
    expect(getNotificationChannels().map((c) => c.id)).toEqual([
      'in_app',
      'email',
      'push',
      // unordered entries sort after ordered ones, then alphabetically by id
      'carrier_pigeon',
      'sms',
    ])
  })

  it('replace clears prior entries', () => {
    registerNotificationChannels([chan('in_app')])
    registerNotificationChannels([chan('email')], { replace: true })
    expect(getNotificationChannels().map((c) => c.id)).toEqual(['email'])
  })

  it('registerNotificationChannelEntries is idempotent by id (first wins)', () => {
    registerNotificationChannelEntries([
      { moduleId: 'notifications', channels: [chan('push', { labelKey: 'first' })] },
      { moduleId: 'other', channels: [chan('push', { labelKey: 'second' })] },
    ])
    expect(getNotificationChannel('push')?.labelKey).toBe('first')
  })
})
