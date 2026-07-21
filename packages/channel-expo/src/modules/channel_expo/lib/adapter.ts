import type {
  SendMessageInput,
  SendMessageResult,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import {
  BasePushChannelAdapter,
  deviceUnregisteredResult,
  MISSING_PUSH_TOKEN_RESULT,
  readPushToken,
  type PushReceiptChecker,
  type PushReceiptOutcome,
} from '@open-mercato/core/modules/communication_channels/lib/push-adapter'
import { readPushEnvelope, resolvePushBody, type PushEnvelope } from '@open-mercato/core/modules/communication_channels/lib/push-envelope'
import { expoCredentialsSchema, type ExpoCredentials } from './credentials'

export interface ExpoPushTicket {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}

/**
 * Async delivery receipt fetched later by ticket id via `getPushNotificationReceiptsAsync`. This is
 * where the common "app uninstalled" case surfaces for Expo (`details.error === 'DeviceNotRegistered'`),
 * NOT the synchronous send ticket.
 */
export interface ExpoPushReceipt {
  status: 'ok' | 'error'
  message?: string
  details?: { error?: string }
}

/**
 * Expo receipt-error codes that mean the device token is permanently invalid ⇒ soft-delete the device
 * (uniform `device_unregistered` contract). Everything else (notably `MessageRateExceeded`) is transient
 * and must NOT kill the token.
 */
const PERMANENT_EXPO_RECEIPT_ERRORS = new Set(['DeviceNotRegistered'])

export interface ExpoPushMessage {
  to: string
  title?: string
  body?: string
  data?: Record<string, string>
  sound?: string
  badge?: number
  priority?: 'default' | 'normal' | 'high'
  channelId?: string
  richContent?: { image?: string }
  /** Data-only / silent delivery (iOS background wake-up). */
  _contentAvailable?: boolean
}

/** Build the Expo message, branching on silent and applying recognized push options. */
export function buildExpoMessage(token: string, envelope: PushEnvelope): ExpoPushMessage {
  const { options, silent } = envelope
  if (silent) {
    return { to: token, data: envelope.data, _contentAvailable: true }
  }
  const message: ExpoPushMessage = {
    to: token,
    title: envelope.title,
    body: resolvePushBody(envelope),
    data: envelope.data,
    sound: options.sound ?? 'default',
  }
  if (typeof options.badge === 'number') message.badge = options.badge
  if (options.priority) message.priority = options.priority
  if (options.channelId) message.channelId = options.channelId
  if (options.image) message.richContent = { image: options.image }
  return message
}

/**
 * Seam over `expo-server-sdk` so the SDK (and its network client) stays out of
 * the adapter control flow and unit tests.
 */
export interface ExpoClientLike {
  isExpoPushToken(token: string): boolean | Promise<boolean>
  send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>
  /** Fetch async delivery receipts keyed by ticket id (chunked internally by the SDK). */
  getReceipts(ticketIds: string[]): Promise<Record<string, ExpoPushReceipt>>
}

type ExpoModule = {
  Expo: {
    isExpoPushToken(token: string): boolean
    new (options: { accessToken?: string }): {
      sendPushNotificationsAsync(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]>
      chunkPushNotificationReceiptIds(receiptIds: string[]): string[][]
      getPushNotificationReceiptsAsync(receiptIds: string[]): Promise<Record<string, ExpoPushReceipt>>
    }
  }
}

export type ExpoClientFactory = (credentials: ExpoCredentials) => ExpoClientLike

let clientFactory: ExpoClientFactory | null = null

/** Test-only seam to swap the Expo client factory. */
export function setExpoClientFactory(factory: ExpoClientFactory | null): void {
  clientFactory = factory
}

type ExpoInstance = InstanceType<ExpoModule['Expo']>

// Bound the Expo client cache like the FCM/APNs adapters. An Expo instance is a plain SDK client (no
// background timer or teardown), so eviction just drops the map entry — but leaving it unbounded would
// grow one entry per distinct tenant access token.
const INSTANCE_CACHE_MAX = 32
const expoInstanceCache = new Map<string, Promise<ExpoInstance>>()

let expoModulePromise: Promise<ExpoModule> | null = null

function loadExpoModule(): Promise<ExpoModule> {
  if (!expoModulePromise) {
    const loading = import('expo-server-sdk').then((mod) => {
      const candidate = mod as unknown as { default?: ExpoModule } & ExpoModule
      return candidate.default ?? candidate
    })
    // Drop a failed import so a later call can retry instead of returning the cached rejection forever.
    loading.catch(() => {
      if (expoModulePromise === loading) expoModulePromise = null
    })
    expoModulePromise = loading
  }
  return expoModulePromise
}

function getExpoInstance(accessToken: string | undefined): Promise<ExpoInstance> {
  const cacheKey = accessToken ?? ''
  const existing = expoInstanceCache.get(cacheKey)
  if (existing) {
    // Refresh recency: delete + re-insert moves the key to the newest position.
    expoInstanceCache.delete(cacheKey)
    expoInstanceCache.set(cacheKey, existing)
    return existing
  }
  const pending = loadExpoModule().then(({ Expo }) => new Expo({ accessToken }))
  // Drop a failed init so a later call can retry instead of returning the cached rejection forever.
  pending.catch(() => {
    if (expoInstanceCache.get(cacheKey) === pending) expoInstanceCache.delete(cacheKey)
  })
  expoInstanceCache.set(cacheKey, pending)
  if (expoInstanceCache.size > INSTANCE_CACHE_MAX) {
    const oldestKey = expoInstanceCache.keys().next().value as string | undefined
    if (oldestKey != null) expoInstanceCache.delete(oldestKey)
  }
  return pending
}

function defaultClientFactory(credentials: ExpoCredentials): ExpoClientLike {
  return {
    async isExpoPushToken(token: string): Promise<boolean> {
      const { Expo } = await loadExpoModule()
      return Expo.isExpoPushToken(token)
    },
    async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
      const expo = await getExpoInstance(credentials.accessToken)
      return expo.sendPushNotificationsAsync(messages)
    },
    async getReceipts(ticketIds: string[]): Promise<Record<string, ExpoPushReceipt>> {
      const expo = await getExpoInstance(credentials.accessToken)
      const receipts: Record<string, ExpoPushReceipt> = {}
      for (const chunk of expo.chunkPushNotificationReceiptIds(ticketIds)) {
        Object.assign(receipts, await expo.getPushNotificationReceiptsAsync(chunk))
      }
      return receipts
    },
  }
}

class ExpoChannelAdapter extends BasePushChannelAdapter implements PushReceiptChecker {
  readonly providerKey = 'expo'
  protected readonly credentialsSchema = expoCredentialsSchema

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const token = readPushToken(input)
    if (!token) return MISSING_PUSH_TOKEN_RESULT

    const parsedCredentials = expoCredentialsSchema.safeParse(input.credentials)
    if (!parsedCredentials.success) {
      return { externalMessageId: '', status: 'failed', error: 'invalid_expo_credentials' }
    }

    const client = (clientFactory ?? defaultClientFactory)(parsedCredentials.data)

    // A malformed Expo token can never deliver — treat it as unregistered so the
    // worker soft-deletes the device (uniform sentinel across providers).
    if (!(await client.isExpoPushToken(token))) {
      return deviceUnregisteredResult({ reason: 'invalid_expo_push_token' })
    }

    const envelope = readPushEnvelope(input.content)

    try {
      const tickets = await client.send([buildExpoMessage(token, envelope)])
      const ticket = tickets[0]
      if (!ticket) return { externalMessageId: '', status: 'failed', error: 'no_response' }
      if (ticket.status === 'ok') {
        return { externalMessageId: ticket.id ?? '', status: 'sent' }
      }
      // Expo delivery is two-phase. A `status: 'ok'` ticket only means Expo *accepted* the message — it
      // does NOT confirm the token is valid. This ticket-level check catches the narrow cases Expo
      // rejects synchronously; the common "app uninstalled" case (`DeviceNotRegistered` for a
      // well-formed-but-stale token) surfaces later in the RECEIPT phase and is pruned by `checkReceipts`
      // below, polled by the push_notifications receipt reaper.
      if (ticket.details?.error === 'DeviceNotRegistered') {
        return deviceUnregisteredResult({ reason: 'DeviceNotRegistered' })
      }
      return { externalMessageId: '', status: 'failed', error: ticket.message ?? 'expo_send_failed' }
    } catch (err) {
      return { externalMessageId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Poll async delivery receipts for previously-accepted tickets and report which map to a
   * permanently-unregistered device token. Returns an entry ONLY for tickets whose receipt is ready
   * (present in the SDK response); tickets with no receipt yet are omitted so the reaper re-checks them
   * on a later sweep. `MessageRateExceeded` (and any other non-`DeviceNotRegistered` error) is treated
   * as transient — the receipt resolves but the token is NOT killed.
   */
  async checkReceipts(ticketIds: string[], credentials: unknown): Promise<PushReceiptOutcome[]> {
    const ids = ticketIds.filter((id) => typeof id === 'string' && id.length > 0)
    if (ids.length === 0) return []

    const parsedCredentials = expoCredentialsSchema.safeParse(credentials ?? {})
    const client = (clientFactory ?? defaultClientFactory)(parsedCredentials.success ? parsedCredentials.data : {})

    const receipts = await client.getReceipts(ids)
    const outcomes: PushReceiptOutcome[] = []
    for (const ticketId of ids) {
      const receipt = receipts[ticketId]
      if (!receipt) continue // receipt not ready yet — leave it for a later sweep
      const unregistered = receipt.status === 'error' && !!receipt.details?.error && PERMANENT_EXPO_RECEIPT_ERRORS.has(receipt.details.error)
      outcomes.push({ ticketId, unregistered })
    }
    return outcomes
  }
}

let cachedAdapter: ExpoChannelAdapter | null = null

export function getExpoChannelAdapter(): ExpoChannelAdapter {
  if (!cachedAdapter) cachedAdapter = new ExpoChannelAdapter()
  return cachedAdapter
}
