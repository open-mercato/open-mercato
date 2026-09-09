import { createHash } from 'node:crypto'
import type {
  SendMessageInput,
  SendMessageResult,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  BasePushChannelAdapter,
  deviceUnregisteredResult,
  MISSING_PUSH_TOKEN_RESULT,
  readPushToken,
} from '@open-mercato/core/modules/communication_channels/lib/push-adapter'
import { createRefCountedClientCache } from '@open-mercato/core/modules/communication_channels/lib/refcounted-client-cache'
import { readPushEnvelope, resolvePushBody, type PushEnvelope } from '@open-mercato/core/modules/communication_channels/lib/push-envelope'
import {
  apnsCredentialsSchema,
  resolveApnsCredentials,
  type ApnsResolvedCredentials,
} from './credentials'

/**
 * The ONLY APNs signal that a device token is permanently dead: HTTP 410 with reason `Unregistered`
 * (the two always travel together — 410 is Apple's irrecoverable "remove this token" status). A bare
 * `410` status whose reason node-apn could not parse means the same thing, so it is included. Both map
 * to the uniform `device_unregistered` sentinel so the push worker soft-deletes the device (identical
 * contract across fcm/apns/expo).
 *
 * `BadDeviceToken` is deliberately EXCLUDED. Apple returns it for a VALID token presented to the wrong
 * environment (a production token hitting the sandbox host, or vice-versa — and `production` defaults
 * to false), not only for a malformed token, and APNs gives no code to disambiguate the two. Treating
 * it as permanent would soft-delete every live iOS device in a tenant on a single environment
 * misconfiguration, with no recovery path. It — like the other non-410 reasons (`DeviceTokenNotForTopic`,
 * `TopicDisallowed`, `PayloadTooLarge`, `TooManyRequests`, `InternalServerError`, `ServiceUnavailable`,
 * `ExpiredProviderToken`) — is a transient/config failure: the delivery retries then expires, but the
 * device is KEPT so it recovers once the sender-side config is fixed.
 */
const PERMANENT_APNS_REASONS = new Set(['Unregistered', '410'])

export interface ApnsSendOutcome {
  ok: boolean
  /** Provider rejection reason (e.g. `Unregistered`, `BadDeviceToken`), or the stringified HTTP status
   * (e.g. `410`) when node-apn could not parse a reason from the response body. */
  reason?: string
  /** Transport-level error message (network/auth), distinct from a provider rejection. */
  error?: string
}

/**
 * A bound APNs sender for one tenant's credentials. The seam keeps `@parse/node-apn`
 * (and its HTTP/2 provider) entirely out of the adapter's control flow and tests.
 */
export type ApnsSender = (payload: PushEnvelope & { topic: string }, token: string) => Promise<ApnsSendOutcome>

export type ApnsSenderFactory = (credentials: ApnsResolvedCredentials) => ApnsSender

let senderFactory: ApnsSenderFactory | null = null

/** Test-only seam to swap the APNs sender factory. */
export function setApnsSenderFactory(factory: ApnsSenderFactory | null): void {
  senderFactory = factory
}

type ApnsProviderLike = {
  send(notification: unknown, token: string): Promise<{
    sent?: Array<{ device: string }>
    failed?: Array<{ device: string; status?: string | number; error?: Error; response?: { reason?: string } }>
  }>
  /** node-apn's Provider exposes `shutdown()` to close its HTTP/2 socket to Apple. */
  shutdown?(): void
}

function credentialsHash(credentials: ApnsResolvedCredentials): string {
  return createHash('sha256')
    .update(`${credentials.keyId}:${credentials.teamId}:${credentials.bundleId}:${credentials.production}:${credentials.p8Key}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * Bounds the number of live HTTP/2 providers cached at once. Each entry holds an
 * open socket to Apple, so an unbounded cache would leak a connection every time a
 * tenant rotates their `.p8` key or toggles `production` (the hash changes → a new
 * entry, while the stale provider never shuts down). LRU-evicting the least-recently
 * used provider and calling `shutdown()` keeps the connection count bounded. Disposal
 * is fenced on in-flight sends: an evicted provider is shut down only once its last
 * concurrent `send` releases (see refcounted-client-cache), so eviction never closes
 * the HTTP/2 socket out from under a send.
 */
const PROVIDER_CACHE_MAX = 32
const providerCache = createRefCountedClientCache<ApnsProviderLike>({
  max: PROVIDER_CACHE_MAX,
  dispose: (provider) => {
    try {
      provider.shutdown?.()
    } catch {
      // shutdown is best-effort; a throwing/absent shutdown must not break eviction.
    }
  },
})

async function createProvider(credentials: ApnsResolvedCredentials): Promise<ApnsProviderLike> {
  const apnModule = await import('@parse/node-apn')
  const apn = (apnModule as { default?: unknown }).default ?? apnModule
  const Provider = (apn as { Provider: new (options: unknown) => ApnsProviderLike }).Provider
  return new Provider({
    token: { key: credentials.p8Key, keyId: credentials.keyId, teamId: credentials.teamId },
    production: credentials.production,
  })
}

/**
 * Populate an APNs `Notification` from the push envelope, branching on `silent` (background
 * content-available wake-up — no alert/sound) and applying the recognized push options. Mutates and
 * returns `note`. Extracted from the sender so it is unit-testable without `@parse/node-apn`.
 */
export function buildApnsNotification(
  note: Record<string, unknown>,
  payload: PushEnvelope & { topic: string },
): Record<string, unknown> {
  const { options, silent } = payload
  note.topic = payload.topic
  note.payload = payload.data
  if (silent) {
    note.contentAvailable = 1
    note.pushType = 'background'
    note.priority = 5
  } else {
    note.alert = { title: payload.title, body: resolvePushBody(payload) }
    note.sound = options.sound ?? 'default'
    if (typeof options.badge === 'number') note.badge = options.badge
    if (options.priority === 'normal') note.priority = 5
  }
  return note
}

function defaultSenderFactory(credentials: ApnsResolvedCredentials): ApnsSender {
  return async (payload, token) => {
    const apnModule = await import('@parse/node-apn')
    const apn = (apnModule as { default?: unknown }).default ?? apnModule
    const Notification = (apn as { Notification: new () => Record<string, unknown> }).Notification
    const note = buildApnsNotification(new Notification(), payload)

    // Borrow a cached provider for the duration of the send; release() in finally keeps an evicted
    // provider's socket open until this send completes.
    const lease = await providerCache.acquire(credentialsHash(credentials), () => createProvider(credentials))
    try {
      const result = await lease.client.send(note, token)
      if (result.sent && result.sent.length > 0) return { ok: true }
      const failure = result.failed?.[0]
      if (!failure) return { ok: false, error: 'no_response' }
      if (failure.error) return { ok: false, error: failure.error.message }
      const reason = failure.response?.reason ?? (failure.status != null ? String(failure.status) : undefined)
      return { ok: false, reason }
    } finally {
      lease.release()
    }
  }
}

class ApnsChannelAdapter extends BasePushChannelAdapter {
  readonly providerKey = 'apns'
  protected readonly credentialsSchema = apnsCredentialsSchema

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const token = readPushToken(input)
    if (!token) return MISSING_PUSH_TOKEN_RESULT

    const parsedCredentials = apnsCredentialsSchema.safeParse(input.credentials)
    if (!parsedCredentials.success) {
      return { externalMessageId: '', status: 'failed', error: 'invalid_apns_credentials' }
    }

    const credentials = resolveApnsCredentials(parsedCredentials.data)
    const envelope = readPushEnvelope(input.content)
    const sender = (senderFactory ?? defaultSenderFactory)(credentials)

    try {
      const outcome = await sender({ ...envelope, topic: credentials.bundleId }, token)
      if (outcome.ok) {
        // node-apn returns no provider message id. Return an empty id rather than any slice of the
        // push token — the worker persists externalMessageId into the admin-exposed provider_response,
        // and this module only ever surfaces the last-8 via token_snapshot, never raw token material.
        return { externalMessageId: '', status: 'sent' }
      }
      if (outcome.reason && PERMANENT_APNS_REASONS.has(outcome.reason)) {
        return deviceUnregisteredResult({ reason: outcome.reason })
      }
      return { externalMessageId: '', status: 'failed', error: outcome.error ?? outcome.reason ?? 'apns_send_failed' }
    } catch (err) {
      return { externalMessageId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) }
    }
  }
}

let cachedAdapter: ApnsChannelAdapter | null = null

export function getApnsChannelAdapter(): ApnsChannelAdapter {
  if (!cachedAdapter) cachedAdapter = new ApnsChannelAdapter()
  return cachedAdapter
}
