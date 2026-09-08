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
  fcmCredentialsSchema,
  parseFcmServiceAccount,
  type FcmServiceAccount,
} from './credentials'

/**
 * FCM error codes that mean the device *token* is permanently invalid. Mapped to
 * the uniform `device_unregistered` sentinel so the push worker soft-deletes the
 * device (identical contract across fcm/apns/expo — see push-stub-adapter).
 *
 * Deliberately excludes `messaging/invalid-argument`: FCM v1 returns it for ANY
 * malformed request field (oversized payload, bad data key, bad notification
 * field), not just a bad token — treating it as unregistered would let a single
 * payload-shape bug progressively soft-delete every targeted device tenant-wide.
 * It falls through to the generic retryable `failed` path instead.
 */
const PERMANENT_FCM_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])

type FirebaseMessaging = {
  send(message: Record<string, unknown>): Promise<string>
}

/**
 * Pluggable messaging factory so tests can inject a fake without importing
 * firebase-admin. Production path lazily loads firebase-admin and caches one app
 * per service-account hash (re-initializing per send is wasteful and
 * firebase-admin throws on duplicate app names).
 */
export type FcmMessagingFactory = (serviceAccount: FcmServiceAccount) => FirebaseMessaging

let messagingFactory: FcmMessagingFactory | null = null

/** Test-only seam to swap the firebase-admin messaging factory. */
export function setFcmMessagingFactory(factory: FcmMessagingFactory | null): void {
  messagingFactory = factory
}

function cacheKeyForServiceAccount(serviceAccount: FcmServiceAccount): string {
  const hash = createHash('sha256')
    .update(`${serviceAccount.projectId}:${serviceAccount.clientEmail}:${serviceAccount.privateKey}`)
    .digest('hex')
    .slice(0, 16)
  return `om-fcm-${hash}`
}

type FcmAppLike = {
  name?: string
  /**
   * firebase-admin's App exposes async `delete()`, which stops the background
   * OAuth token-refresh timer bound to the service-account credential and drops
   * the app from the SDK's registry.
   */
  delete(): Promise<void>
}

/**
 * Bounds the number of live firebase-admin apps cached at once. Each app holds a
 * service-account OAuth credential with a background token-refresh timer, so an
 * unbounded cache would leak an app (and its timer) every time a tenant rotates
 * their service account (the hash changes → a new app, while the stale app never
 * gets deleted). LRU-evicting the least-recently used app and calling `delete()`
 * keeps the app and timer count bounded. Disposal is fenced on in-flight sends: an
 * evicted app is deleted only once its last concurrent `send` releases (see
 * refcounted-client-cache), so eviction never tears an app out from under a send.
 */
const APP_CACHE_MAX = 32
const appCache = createRefCountedClientCache<FcmAppLike>({
  max: APP_CACHE_MAX,
  dispose: (app) => {
    void app.delete().catch(() => {})
  },
})

// firebase-admin registers every app by name in a process-global registry and throws on a duplicate
// name. Cache keys are per-credential-identity (a rotated service account churns keys in and out), so a
// stable name-per-credential would let a re-created entry reuse — via getApps() — an app a still-in-flight
// evicted entry is about to delete(). A monotonic suffix makes every initialized app name unique, so each
// cache entry owns exactly one app and disposing an evicted app can never affect a live one.
let appInitSeq = 0

async function createFirebaseApp(serviceAccount: FcmServiceAccount, appName: string): Promise<FcmAppLike> {
  const { initializeApp, cert } = await import('firebase-admin/app')
  return initializeApp(
    {
      credential: cert({
        projectId: serviceAccount.projectId,
        clientEmail: serviceAccount.clientEmail,
        privateKey: serviceAccount.privateKey,
      }),
    },
    appName,
  ) as unknown as FcmAppLike
}

/**
 * Build the firebase-admin message from the push envelope, branching on
 * `envelope.silent` (data-only content-available wake-up) and applying the
 * recognized `pushOptions` (sound/badge/image/priority/channelId) per platform.
 */
export function buildFcmMessage(token: string, envelope: PushEnvelope): Record<string, unknown> {
  const { options, silent } = envelope
  const apnsPriority = options.priority === 'normal' ? '5' : '10'

  if (silent) {
    return {
      token,
      data: envelope.data,
      android: { priority: 'high' },
      apns: {
        headers: { 'apns-push-type': 'background', 'apns-priority': '5' },
        payload: { aps: { 'content-available': 1 } },
      },
    }
  }

  const body = resolvePushBody(envelope)
  const sound = options.sound ?? 'default'
  const androidNotification: Record<string, unknown> = { sound }
  if (options.channelId) androidNotification.channelId = options.channelId
  if (options.image) androidNotification.imageUrl = options.image
  const aps: Record<string, unknown> = { sound }
  if (typeof options.badge === 'number') aps.badge = options.badge

  return {
    token,
    notification: {
      title: envelope.title,
      body,
      ...(options.image ? { imageUrl: options.image } : {}),
    },
    data: envelope.data,
    android: {
      ...(options.priority ? { priority: options.priority } : {}),
      notification: androidNotification,
    },
    apns: {
      headers: { 'apns-priority': apnsPriority },
      payload: { aps },
    },
  }
}

class FcmChannelAdapter extends BasePushChannelAdapter {
  readonly providerKey = 'fcm'
  protected readonly credentialsSchema = fcmCredentialsSchema

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const token = readPushToken(input)
    if (!token) return MISSING_PUSH_TOKEN_RESULT

    const parsedCredentials = fcmCredentialsSchema.safeParse(input.credentials)
    if (!parsedCredentials.success) {
      return { externalMessageId: '', status: 'failed', error: 'invalid_fcm_credentials' }
    }

    const envelope = readPushEnvelope(input.content)
    let serviceAccount: FcmServiceAccount
    try {
      serviceAccount = parseFcmServiceAccount(parsedCredentials.data)
    } catch (err) {
      return { externalMessageId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) }
    }
    const message = buildFcmMessage(token, envelope)

    // Test seam: an injected factory bypasses the app cache entirely.
    if (messagingFactory) {
      let messaging: FirebaseMessaging
      try {
        messaging = messagingFactory(serviceAccount)
      } catch (err) {
        return { externalMessageId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) }
      }
      return this.performSend(messaging, message)
    }

    // Production path: borrow a cached firebase-admin app for the duration of the send. Holding the
    // lease keeps an evicted app alive until the send completes (release() in finally).
    const cacheKey = cacheKeyForServiceAccount(serviceAccount)
    let lease
    try {
      appInitSeq += 1
      const appName = `${cacheKey}-${appInitSeq}`
      lease = await appCache.acquire(cacheKey, () => createFirebaseApp(serviceAccount, appName))
    } catch (err) {
      return { externalMessageId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) }
    }
    try {
      const { getMessaging } = await import('firebase-admin/messaging')
      const messaging = getMessaging(lease.client as never) as unknown as FirebaseMessaging
      return await this.performSend(messaging, message)
    } catch (err) {
      return { externalMessageId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) }
    } finally {
      lease.release()
    }
  }

  private async performSend(
    messaging: FirebaseMessaging,
    message: Record<string, unknown>,
  ): Promise<SendMessageResult> {
    try {
      const externalMessageId = await messaging.send(message)
      return { externalMessageId, status: 'sent' }
    } catch (err) {
      const code = typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : undefined
      const errorMessage = err instanceof Error ? err.message : String(err)
      if (code && PERMANENT_FCM_ERROR_CODES.has(code)) {
        return deviceUnregisteredResult({ code })
      }
      return { externalMessageId: '', status: 'failed', error: errorMessage }
    }
  }
}

let cachedAdapter: FcmChannelAdapter | null = null

export function getFcmChannelAdapter(): FcmChannelAdapter {
  if (!cachedAdapter) cachedAdapter = new FcmChannelAdapter()
  return cachedAdapter
}
