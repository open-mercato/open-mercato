import {
  isPushFakeProvidersEnabled,
  recordFakePush,
} from '@open-mercato/core/modules/push_notifications/lib/fake-provider-recorder'
import { setFcmMessagingFactory } from './adapter'

/**
 * Network-free `firebase-admin` messaging client used ONLY by integration tests.
 *
 * Swaps the SDK client behind the adapter's existing seam, so every line of the real adapter still
 * runs — message construction, credential parsing, client caching, and the
 * `messaging/registration-token-not-registered` → `device_unregistered` mapping. The adapter itself is
 * never replaced (unlike `push_stub`), and is never re-registered: `registerChannelAdapter` throws on a
 * duplicate provider key.
 *
 * Token sentinels match `push_stub`'s convention (see push-stub-adapter.ts):
 *   - token containing `unregistered` → FCM's native permanent-token error code
 *   - token containing `fail`         → a retryable error (no `code`, so the adapter retries)
 *   - otherwise                        → success
 *
 * Production safety: never installed at module import; no-op unless `OM_PUSH_FAKE_PROVIDERS` is set.
 */
function fakeSendError(message: string, code?: string): Error {
  const error = new Error(message)
  if (code) Object.assign(error, { code })
  return error
}

export function ensureFcmFakeProviderInstalled(): void {
  if (!isPushFakeProvidersEnabled()) return
  setFcmMessagingFactory(() => ({
    async send(message: Record<string, unknown>): Promise<string> {
      const token = typeof message.token === 'string' ? message.token : ''
      recordFakePush('fcm', token, message)
      if (token.includes('unregistered')) {
        throw fakeSendError('fake fcm token not registered', 'messaging/registration-token-not-registered')
      }
      if (token.includes('fail')) {
        throw fakeSendError('fake fcm transient failure')
      }
      return `fcm-fake-${token.slice(-8) || 'token'}`
    },
  }))
}
