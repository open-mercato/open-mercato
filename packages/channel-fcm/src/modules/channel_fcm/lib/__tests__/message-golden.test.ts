import type { PushEnvelope } from '@open-mercato/core/modules/communication_channels/lib/push-envelope'
import { buildFcmMessage } from '../adapter'

/**
 * Golden assertions pinning the FCM message we build against Google's published reference shape.
 *
 * These are the only tests that catch serialization drift in *our* builder: the integration fakes
 * replace the SDK client, so nothing else ever validates the message body. Drift in *Google's* schema
 * is out of reach of any fake and stays a manual live-key check.
 *
 * Reference: https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages#Message
 * APNs headers within FCM: https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages#ApnsConfig
 *
 * Written as exact `toEqual` fixtures rather than snapshots: a snapshot would re-record drift on
 * `--updateSnapshot` instead of failing.
 */
const TOKEN = 'device-token-abcdef12'

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

describe('buildFcmMessage — golden payloads', () => {
  it('visible notification matches the reference shape', () => {
    expect(buildFcmMessage(TOKEN, envelope())).toEqual({
      token: TOKEN,
      notification: {
        title: 'Order shipped',
        body: 'Your order #42 is on its way',
      },
      data: { type: 'orders.shipped', notificationId: 'n1' },
      android: {
        notification: { sound: 'default' },
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default' } },
      },
    })
  })

  it('silent notification is data-only with content-available and a background push type', () => {
    expect(buildFcmMessage(TOKEN, envelope({ silent: true }))).toEqual({
      token: TOKEN,
      data: { type: 'orders.shipped', notificationId: 'n1' },
      android: { priority: 'high' },
      apns: {
        headers: { 'apns-push-type': 'background', 'apns-priority': '5' },
        payload: { aps: { 'content-available': 1 } },
      },
    })
  })

  it('full pushOptions map onto each platform', () => {
    const message = buildFcmMessage(
      TOKEN,
      envelope({
        options: {
          sound: 'chime.caf',
          badge: 7,
          image: 'https://cdn.example.com/hero.png',
          priority: 'normal',
          channelId: 'orders',
          body: 'Overridden push body',
        },
      }),
    )

    expect(message).toEqual({
      token: TOKEN,
      notification: {
        title: 'Order shipped',
        body: 'Overridden push body',
        imageUrl: 'https://cdn.example.com/hero.png',
      },
      data: { type: 'orders.shipped', notificationId: 'n1' },
      android: {
        priority: 'normal',
        notification: {
          sound: 'chime.caf',
          channelId: 'orders',
          imageUrl: 'https://cdn.example.com/hero.png',
        },
      },
      apns: {
        headers: { 'apns-priority': '5' },
        payload: { aps: { sound: 'chime.caf', badge: 7 } },
      },
    })
  })
})
