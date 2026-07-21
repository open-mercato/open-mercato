import type { ZodType } from 'zod'
import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelNativeContent,
  ConvertOutboundInput,
  GetMessageStatusInput,
  InboundMessage,
  MessageStatus,
  NormalizedInboundMessage,
  SendMessageInput,
  SendMessageResult,
  ValidateCredentialsInput,
  ValidateCredentialsResult,
  VerifyWebhookInput,
} from './adapter'
import { pushChannelCapabilities } from './push-capabilities'

/**
 * Uniform sentinel a push adapter returns for a permanently-invalid device token.
 * The `push_notifications` worker checks `error === DEVICE_UNREGISTERED ||
 * metadata.unregistered === true` and soft-deletes the device — so every push
 * provider (fcm/apns/expo + the test stub) MUST use this exact shape.
 */
export const DEVICE_UNREGISTERED = 'device_unregistered'

/** Build the uniform `device_unregistered` result. Extra metadata is merged in. */
export function deviceUnregisteredResult(metadata?: Record<string, unknown>): SendMessageResult {
  return {
    externalMessageId: '',
    status: 'failed',
    error: DEVICE_UNREGISTERED,
    metadata: { unregistered: true, ...(metadata ?? {}) },
  }
}

/** Standard result when a send is attempted without a device token. */
export const MISSING_PUSH_TOKEN_RESULT: SendMessageResult = {
  externalMessageId: '',
  status: 'failed',
  error: 'missing_push_token',
}

/**
 * Outcome of checking one provider delivery receipt for a previously-accepted push.
 * Emitted only for tickets whose receipt is already available (`resolved`); a ticket whose
 * receipt is not yet ready is omitted so the caller retries it on a later sweep.
 */
export interface PushReceiptOutcome {
  /** The provider ticket id returned by the synchronous send (persisted as `externalMessageId`). */
  ticketId: string
  /** The receipt reports the device token is permanently invalid ⇒ soft-delete the device. */
  unregistered: boolean
}

/**
 * Optional capability for providers whose "device unregistered" signal arrives in an ASYNCHRONOUS
 * receipt phase rather than the synchronous send ticket (Expo). Implemented by the Expo adapter and
 * polled by the push_notifications receipt reaper; FCM/APNs prune synchronously in `sendMessage` and
 * do not implement it. Additive to `ChannelAdapter` — feature-detected via `supportsReceiptChecking`.
 */
export interface PushReceiptChecker {
  /**
   * Fetch delivery receipts for previously-accepted push tickets and report which map to a
   * permanently-unregistered device token. Return an entry ONLY for tickets whose receipt is ready;
   * omit tickets with no receipt yet so the caller re-checks them later. Reuses the same tenant
   * credentials as the send path.
   */
  checkReceipts(ticketIds: string[], credentials: unknown): Promise<PushReceiptOutcome[]>
}

/** Feature-detect the optional `PushReceiptChecker` capability on a resolved channel adapter. */
export function supportsReceiptChecking(adapter: unknown): adapter is PushReceiptChecker {
  return typeof (adapter as { checkReceipts?: unknown } | null | undefined)?.checkReceipts === 'function'
}

/** Extract the per-call push token from `SendMessageInput.metadata`, or null if absent. */
export function readPushToken(input: SendMessageInput): string | null {
  const token = typeof input.metadata?.pushToken === 'string' ? input.metadata.pushToken : ''
  return token.length > 0 ? token : null
}

/**
 * Shared base for outbound-only mobile-push `ChannelAdapter`s (fcm/apns/expo and
 * the test `push_stub`). Concrete adapters provide just `providerKey`,
 * `credentialsSchema`, and `sendMessage`; the push capabilities baseline, the
 * no-op inbound surface (push is outbound-only), the passthrough `convertOutbound`,
 * and schema-driven `validateCredentials` are shared so the push family stays
 * consistent. This is push-specific and does NOT change the per-package
 * standalone convention used by the email channel adapters (gmail/imap).
 */
export abstract class BasePushChannelAdapter implements ChannelAdapter {
  abstract readonly providerKey: string
  readonly channelType = 'push'
  // Push credentials (service account / signing key) serve every device in the
  // tenant, so a push channel is tenant-wide (user_id = NULL), connected by an
  // admin — never a per-user channel. Covers fcm/apns/expo + the test stub.
  readonly channelScope = 'tenant' as const
  readonly capabilities: ChannelCapabilities = pushChannelCapabilities

  /** Zod schema for this provider's tenant-level credentials; drives `validateCredentials`. */
  protected abstract readonly credentialsSchema: ZodType<unknown>

  abstract sendMessage(input: SendMessageInput): Promise<SendMessageResult>

  async convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
    return { content: { text: input.body, bodyFormat: input.bodyFormat }, metadata: input.channelMetadata ?? {} }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    return { raw: {}, eventType: 'other', metadata: { reason: `${this.providerKey}-no-webhook` } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    return { status: 'sent' }
  }

  async normalizeInbound(_raw: InboundMessage): Promise<NormalizedInboundMessage> {
    throw new Error(`[internal] ${this.providerKey} push adapter normalizeInbound is not used (push is outbound-only)`)
  }

  async validateCredentials(input: ValidateCredentialsInput): Promise<ValidateCredentialsResult> {
    const parsed = this.credentialsSchema.safeParse(input.credentials)
    if (parsed.success) return { ok: true }
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === 'string' && !errors[key]) errors[key] = issue.message
    }
    return { ok: false, errors }
  }
}
