import {
  isPushFakeProvidersEnabled,
  recordFakePush,
  warnPushFakeProvidersActive,
} from '@open-mercato/core/modules/push_notifications/lib/fake-provider-recorder'
import { buildApnsNotification, setApnsSenderFactory } from './adapter'

/**
 * Network-free `@parse/node-apn` sender used ONLY by integration tests.
 *
 * Swaps the SDK client behind the adapter's existing seam, so the real adapter still runs its
 * credential resolution and its `Unregistered`/`410` → `device_unregistered` mapping. The adapter
 * itself is never replaced or re-registered.
 *
 * Unlike FCM and Expo, the APNs seam sits *above* the message builder: the sender receives the raw
 * envelope, and `buildApnsNotification(new Notification(), …)` runs inside the real sender factory this
 * fake replaces. The fake therefore builds against a **real `apn.Notification`** too, and records the
 * wire form node-apn would transmit (`headers()` + the compiled `aps` payload) rather than a plain-object
 * projection the SDK never serializes. Only the network provider is faked. `.p8` parsing lives in the
 * replaced factory, so fake credentials need only a valid shape.
 *
 * Token sentinels match `push_stub`'s convention (see push-stub-adapter.ts):
 *   - token containing `unregistered` → APNs' native permanent-token reason
 *   - token containing `fail`         → a retryable error
 *   - otherwise                        → success
 *
 * Production safety: never installed at module import; no-op unless `OM_PUSH_FAKE_PROVIDERS` is set.
 */
type ApnsNotificationLike = Record<string, unknown> & {
  headers(): Record<string, unknown>
  compile(): string
}

async function newApnsNotification(): Promise<ApnsNotificationLike> {
  const apnModule = await import('@parse/node-apn')
  const apn = (apnModule as { default?: unknown }).default ?? apnModule
  const Notification = (apn as { Notification: new () => ApnsNotificationLike }).Notification
  return new Notification()
}

export function ensureApnsFakeProviderInstalled(): void {
  if (!isPushFakeProvidersEnabled()) return
  warnPushFakeProvidersActive('apns')
  setApnsSenderFactory(() => async (payload, token) => {
    const note = buildApnsNotification(await newApnsNotification(), payload) as ApnsNotificationLike
    recordFakePush('apns', token, {
      headers: note.headers(),
      payload: JSON.parse(note.compile()) as Record<string, unknown>,
    })
    if (token.includes('unregistered')) return { ok: false, reason: 'Unregistered' }
    if (token.includes('fail')) return { ok: false, error: 'fake apns transient failure' }
    return { ok: true }
  })
}
