import type { PushEnvelope } from '@open-mercato/core/modules/communication_channels/lib/push-envelope'
import { buildExpoMessage } from '../adapter'

/**
 * Golden assertions pinning the Expo push message we build against Expo's published reference.
 *
 * These are the only tests that catch serialization drift in *our* builder: the integration fakes
 * replace the SDK client, so nothing else ever validates the message body. Drift in *Expo's* schema is
 * out of reach of any fake and stays a manual live-key check.
 *
 * Reference: https://docs.expo.dev/push-notifications/sending-notifications/#message-request-format
 * `_contentAvailable` (data-only iOS background wake-up):
 *   https://docs.expo.dev/push-notifications/sending-notifications/#formats
 *
 * Written as exact `toEqual` fixtures rather than snapshots: a snapshot would re-record drift on
 * `--updateSnapshot` instead of failing.
 */
const TOKEN = 'ExponentPushToken[abcdef12]'

function envelope(overrides: Partial<PushEnvelope> = {}): PushEnvelope {
  return {
    title: 'Order shipped',
    body: 'Your order #42 is on its way',
    data: { type: 'orders.shipped', notificationId: 'n1' },
    options: {},
    silent: false,
    ...overrides,
  }
}

describe('buildExpoMessage — golden payloads', () => {
  it('visible notification matches the reference shape', () => {
    expect(buildExpoMessage(TOKEN, envelope())).toEqual({
      to: TOKEN,
      title: 'Order shipped',
      body: 'Your order #42 is on its way',
      data: { type: 'orders.shipped', notificationId: 'n1' },
      sound: 'default',
    })
  })

  it('silent notification is data-only with _contentAvailable and no user-facing copy', () => {
    expect(buildExpoMessage(TOKEN, envelope({ silent: true }))).toEqual({
      to: TOKEN,
      data: { type: 'orders.shipped', notificationId: 'n1' },
      _contentAvailable: true,
    })
  })

  it('full pushOptions map onto the message', () => {
    expect(
      buildExpoMessage(
        TOKEN,
        envelope({
          options: {
            sound: 'chime.caf',
            badge: 7,
            image: 'https://cdn.example.com/hero.png',
            priority: 'high',
            channelId: 'orders',
            body: 'Overridden push body',
          },
        }),
      ),
    ).toEqual({
      to: TOKEN,
      title: 'Order shipped',
      body: 'Overridden push body',
      data: { type: 'orders.shipped', notificationId: 'n1' },
      sound: 'chime.caf',
      badge: 7,
      priority: 'high',
      channelId: 'orders',
      richContent: { image: 'https://cdn.example.com/hero.png' },
    })
  })
})
