import apn from '@parse/node-apn'
import type { PushEnvelope } from '@open-mercato/core/modules/communication_channels/lib/push-envelope'
import { buildApnsNotification } from '../adapter'

/**
 * Golden assertions pinning the APNs notification we build against Apple's published reference.
 *
 * These are the only tests that catch serialization drift in *our* builder: the integration fakes
 * replace the network provider, so nothing else validates the notification body. Drift in *Apple's*
 * schema is out of reach of any fake and stays a manual live-key check.
 *
 * Built against a REAL `apn.Notification` — exactly as the production sender does
 * (`adapter.ts:143`) — and asserted on the wire form node-apn actually transmits: the compiled `aps`
 * payload and the request headers. Pinning a plain-object projection instead would pin a shape the SDK
 * never serializes, which is precisely the drift these tests exist to catch.
 *
 * Reference (aps payload): https://developer.apple.com/documentation/usernotifications/generating-a-remote-notification
 * Reference (background push requires apns-push-type: background + apns-priority: 5):
 *   https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app
 *
 * Written as exact `toEqual` fixtures rather than snapshots: a snapshot would re-record drift on
 * `--updateSnapshot` instead of failing.
 */
const TOPIC = 'com.example.app'

function payload(overrides: Partial<PushEnvelope> = {}): PushEnvelope & { topic: string } {
  return {
    topic: TOPIC,
    title: 'Order shipped',
    body: 'Your order #42 is on its way',
    data: { type: 'orders.shipped', notificationId: 'n1' },
    options: {},
    silent: false,
    ...overrides,
  }
}

type CompiledNotification = { headers: Record<string, unknown>; aps: Record<string, unknown> }

function build(envelope: PushEnvelope & { topic: string }): CompiledNotification {
  const note = buildApnsNotification(new apn.Notification(), envelope) as unknown as {
    headers(): Record<string, unknown>
    compile(): string
  }
  return { headers: note.headers(), aps: JSON.parse(note.compile()) as Record<string, unknown> }
}

describe('buildApnsNotification — golden payloads', () => {
  it('visible notification compiles to the reference aps payload', () => {
    const { headers, aps } = build(payload())
    // The envelope's custom `data` is carried as top-level keys beside `aps` on every branch, visible
    // or silent — the app reads them from the notification's userInfo.
    expect(aps).toEqual({
      type: 'orders.shipped',
      notificationId: 'n1',
      aps: {
        alert: { title: 'Order shipped', body: 'Your order #42 is on its way' },
        sound: 'default',
      },
    })
    expect(headers).toEqual({ 'apns-priority': 10, 'apns-topic': TOPIC })
  })

  it('silent notification is a content-available background push at priority 5', () => {
    const { headers, aps } = build(payload({ silent: true }))
    // Data-only: the custom keys sit beside `aps`, and no alert/sound is present.
    expect(aps).toEqual({
      type: 'orders.shipped',
      notificationId: 'n1',
      aps: { 'content-available': 1 },
    })
    expect(headers).toEqual({
      'apns-priority': 5,
      'apns-topic': TOPIC,
      'apns-push-type': 'background',
    })
  })

  it('full pushOptions map onto the aps payload', () => {
    const { headers, aps } = build(
      payload({
        options: {
          sound: 'chime.caf',
          badge: 7,
          priority: 'normal',
          body: 'Overridden push body',
        },
      }),
    )
    expect(aps).toEqual({
      type: 'orders.shipped',
      notificationId: 'n1',
      aps: {
        alert: { title: 'Order shipped', body: 'Overridden push body' },
        sound: 'chime.caf',
        badge: 7,
      },
    })
    expect(headers).toEqual({ 'apns-priority': 5, 'apns-topic': TOPIC })
  })
})
