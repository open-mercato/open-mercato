import { z } from 'zod'
import type {
  SendMessageInput,
  SendMessageResult,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  BasePushChannelAdapter,
  deviceUnregisteredResult,
  readPushToken,
} from '@open-mercato/core/modules/communication_channels/lib/push-adapter'
import { readPushEnvelope } from '@open-mercato/core/modules/communication_channels/lib/push-envelope'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'

/**
 * In-process, network-free `push` channel adapter used ONLY by tests.
 *
 * Real provider adapters (FCM/APNs/Expo) land in Phase 4 as separate channel packages. Phase 3 ships
 * this stub so the strategy → delivery-row → worker → `sendMessage` chain is exercisable end-to-end.
 *
 * Token sentinels let a test drive each worker branch deterministically:
 *   - a token containing `unregistered` → the uniform `unregistered` shape (worker soft-deletes the device)
 *   - a token containing `fail`         → a retryable failure (worker retries then marks `failed`)
 *   - otherwise                          → `sent`
 *
 * Production safety: never registered at module import. The integration harness calls
 * {@link ensurePushStubAdapterRegistered}, gated by `OM_ENABLE_PUSH_STUB_ADAPTER`.
 */
export const PUSH_STUB_PROVIDER_KEY = 'push_stub'
export const PUSH_STUB_ENV = 'OM_ENABLE_PUSH_STUB_ADAPTER'

export function isPushStubEnabled(): boolean {
  const raw = process.env[PUSH_STUB_ENV]
  if (typeof raw !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

class PushStubChannelAdapter extends BasePushChannelAdapter {
  readonly providerKey = PUSH_STUB_PROVIDER_KEY
  protected readonly credentialsSchema = z.object({}).passthrough()

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const token = readPushToken(input) ?? ''
    if (token.includes('unregistered')) {
      return deviceUnregisteredResult({ stub: true })
    }
    if (token.includes('fail')) {
      return { externalMessageId: '', status: 'failed', error: 'push_stub_forced_failure', metadata: { stub: true } }
    }
    // Surface the resolved envelope (silent flag, custom data, mapped options) so
    // integration tests can assert what the worker handed the adapter per delivery.
    const envelope = readPushEnvelope(input.content)
    return {
      externalMessageId: `push-stub-${token.slice(-8) || 'token'}`,
      status: 'sent',
      metadata: {
        stub: true,
        silent: envelope.silent,
        data: envelope.data,
        options: envelope.options,
      },
    }
  }
}

let cachedPushStubAdapter: PushStubChannelAdapter | null = null

export function getPushStubAdapter(): PushStubChannelAdapter {
  if (!cachedPushStubAdapter) cachedPushStubAdapter = new PushStubChannelAdapter()
  return cachedPushStubAdapter
}

/** Register the push stub adapter once, ONLY when the test env flag is set. No-op otherwise. */
export function ensurePushStubAdapterRegistered(): void {
  if (!isPushStubEnabled()) return
  if (hasChannelAdapter(PUSH_STUB_PROVIDER_KEY)) return
  registerChannelAdapter(getPushStubAdapter())
}
