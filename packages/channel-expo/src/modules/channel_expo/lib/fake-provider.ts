import {
  isPushFakeProvidersEnabled,
  recordFakePush,
} from '@open-mercato/core/modules/push_notifications/lib/fake-provider-recorder'
import {
  setExpoClientFactory,
  type ExpoPushMessage,
  type ExpoPushReceipt,
  type ExpoPushTicket,
} from './adapter'

/**
 * Network-free `expo-server-sdk` client used ONLY by integration tests.
 *
 * Swaps the SDK client behind the adapter's existing seam, so the real adapter still runs its token
 * validation, chunking, and `DeviceNotRegistered` → `device_unregistered` mapping. The adapter itself is
 * never replaced or re-registered.
 *
 * `isExpoPushToken` accepts every token: the sentinels below are not real `ExponentPushToken[...]`
 * values, and rejecting them would short-circuit the adapter before it ever reaches the ticket path.
 *
 * Token sentinels match `push_stub`'s convention (see push-stub-adapter.ts):
 *   - token containing `unregistered` → an accepted ticket whose *receipt* later reports
 *     `DeviceNotRegistered`, reproducing Expo's real two-phase behavior for an uninstalled app
 *   - token containing `fail`         → a rejected ticket (retryable)
 *   - otherwise                        → success
 *
 * The sentinel is encoded into the ticket id because `getReceipts` is polled by the reaper in a
 * *different* process than the send: the fake keeps no cross-process state.
 *
 * Production safety: never installed at module import; no-op unless `OM_PUSH_FAKE_PROVIDERS` is set.
 */
const UNREGISTERED_TICKET_MARKER = 'unreg'

export function ensureExpoFakeProviderInstalled(): void {
  if (!isPushFakeProvidersEnabled()) return
  setExpoClientFactory(() => ({
    isExpoPushToken(): boolean {
      return true
    },
    async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
      return messages.map((message) => {
        const token = message.to
        recordFakePush('expo', token, message as unknown as Record<string, unknown>)
        if (token.includes('fail')) {
          return { status: 'error', message: 'fake expo transient failure' }
        }
        const marker = token.includes('unregistered') ? `${UNREGISTERED_TICKET_MARKER}-` : ''
        return { status: 'ok', id: `expo-fake-${marker}${token.slice(-8) || 'token'}` }
      })
    },
    async getReceipts(ticketIds: string[]): Promise<Record<string, ExpoPushReceipt>> {
      const receipts: Record<string, ExpoPushReceipt> = {}
      for (const ticketId of ticketIds) {
        receipts[ticketId] = ticketId.includes(`-${UNREGISTERED_TICKET_MARKER}-`)
          ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok' }
      }
      return receipts
    },
  }))
}
