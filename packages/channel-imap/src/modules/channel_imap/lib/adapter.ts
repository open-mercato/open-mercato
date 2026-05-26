import type {
  ChannelAdapter,
  ConvertOutboundInput,
  ChannelNativeContent,
  FetchHistoryInput,
  GetMessageStatusInput,
  HistoryPage,
  InboundMessage,
  MessageStatus,
  NormalizedInboundMessage,
  ResolveContactInput,
  ContactHint,
  SendMessageInput,
  SendMessageResult,
  ValidateCredentialsInput,
  ValidateCredentialsResult,
  VerifyWebhookInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { imapCapabilities } from './capabilities'
import { imapCredentialsSchema, imapChannelStateSchema, type ImapCredentials, type ImapChannelState } from './credentials'
import {
  credentialsToConnection,
  getImapClient,
} from './imap-client'
import {
  credentialsToSmtpConnection,
  getSmtpClient,
} from './smtp-client'
import { convertOutboundForEmail } from './convert-outbound'
import { normalizeInboundImapMessage } from './normalize-inbound'
import { validateImapCredentials } from './validate-credentials'

/**
 * IMAP+SMTP `ChannelAdapter`. Inbound is polling-driven (`realtimePush: false`),
 * outbound is SMTP. Threading is RFC2822 (In-Reply-To / References).
 *
 * Why this adapter omits some methods:
 *   - `verifyWebhook` — IMAP has no webhook; we return a no-op event with
 *     `eventType: 'other'` so the hub's webhook route returns 202 if anyone
 *     ever POSTs at `/api/communication_channels/webhook/imap`.
 *   - `getStatus` — IMAP has no delivery-status concept beyond `\Seen`; we
 *     return `{ status: 'sent' }` as a best-effort placeholder.
 *   - No `sendReaction` / `editMessage` / `deleteMessage` — email doesn't
 *     support these capabilities.
 */
class ImapChannelAdapter implements ChannelAdapter {
  readonly providerKey = 'imap'
  readonly channelType = 'email'
  readonly capabilities = imapCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const credentials = parseCredentialsOrThrow(input.credentials)
    let native: ChannelNativeContent
    try {
      native = await convertOutboundForEmail({
        body: input.content.html ?? input.content.text ?? '',
        bodyFormat: input.content.bodyFormat ?? (input.content.html ? 'html' : 'text'),
        attachments: input.content.attachments,
        channelMetadata: input.metadata,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outbound conversion failed'
      return { externalMessageId: '', status: 'failed', error: message }
    }
    const meta = (native.metadata ?? {}) as Record<string, unknown>
    const to = Array.isArray(meta.to) ? (meta.to as string[]) : []
    if (to.length === 0) {
      return { externalMessageId: '', status: 'failed', error: 'Email send requires at least one recipient' }
    }

    // Reject attachments at the boundary rather than silently sending empty
    // bytes. The hub passes attachments as URL pointers; until the IMAP/SMTP
    // adapter wires a fetcher (with size + content-type validation), inlining
    // them is unsafe — a 0-byte attachment looks "delivered" but conveys nothing.
    // This is documented in review M2 (2026-05-26) and tracked as a follow-up.
    if (Array.isArray(input.content.attachments) && input.content.attachments.length > 0) {
      return {
        externalMessageId: '',
        status: 'failed',
        error:
          'IMAP/SMTP adapter does not yet support attachments. Send the message without attachments or use a provider that supports them (Gmail / Microsoft).',
      }
    }

    const smtp = getSmtpClient()
    const result = await smtp.send(credentialsToSmtpConnection(credentials), {
      from: credentials.fromAddress,
      to,
      cc: Array.isArray(meta.cc) ? (meta.cc as string[]) : undefined,
      bcc: Array.isArray(meta.bcc) ? (meta.bcc as string[]) : undefined,
      subject: typeof meta.subject === 'string' ? (meta.subject as string) : undefined,
      text: native.content.text,
      html: native.content.html,
      inReplyTo: typeof meta.inReplyTo === 'string' ? (meta.inReplyTo as string) : undefined,
      references: Array.isArray(meta.references) ? (meta.references as string[]) : undefined,
      messageId: typeof meta.messageId === 'string' ? (meta.messageId as string) : undefined,
    })

    // Best-effort append to Sent — many servers auto-store via "Submission" but not all do.
    const imap = getImapClient()
    try {
      await imap.appendSent(credentialsToConnection(credentials, 'imap'), result.raw)
    } catch {
      // Swallow — best effort.
    }

    return {
      externalMessageId: result.messageId,
      conversationId: input.conversationId,
      status: 'sent',
      metadata: { response: result.response },
    }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    return { raw: {}, eventType: 'other', metadata: { reason: 'imap-does-not-use-webhooks' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    return { status: 'sent' }
  }

  async convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
    return convertOutboundForEmail(input)
  }

  async normalizeInbound(raw: InboundMessage): Promise<NormalizedInboundMessage> {
    const rawBuffer = pickRawMimeBuffer(raw)
    const accountIdentifier = pickAccountIdentifier(raw)
    const uid = pickUid(raw)
    return normalizeInboundImapMessage({
      rawMessage: rawBuffer,
      uid,
      accountIdentifier,
    })
  }

  async validateCredentials(input: ValidateCredentialsInput): Promise<ValidateCredentialsResult> {
    return validateImapCredentials(input.credentials)
  }

  async fetchHistory(input: FetchHistoryInput): Promise<HistoryPage> {
    const credentials = parseCredentialsOrThrow(input.credentials)
    const channelState = imapChannelStateSchema.parse(((input as unknown) as { channelState?: unknown }).channelState ?? {}) satisfies ImapChannelState
    const imap = getImapClient()
    const connection = credentialsToConnection(credentials, 'imap')

    const folderState = await imap.selectInbox(connection)
    const previousUidValidity = toNumberOrUndefined(channelState.uidValidity)
    const previousUidNext = toNumberOrUndefined(channelState.uidNext)
    const serverUidNext = toNumberOrUndefined(folderState.uidNext)

    const fullResync = previousUidValidity !== undefined && folderState.uidValidity !== previousUidValidity
    const range = fullResync || previousUidNext === undefined
      ? '1:*'
      : `${previousUidNext}:*`
    const limit = input.limit ?? 100
    const fetched = await imap.fetchUidRange(connection, range, { limit })

    const messages: NormalizedInboundMessage[] = []
    let maxUidFetchedPlusOne = previousUidNext ?? 0
    for (const item of fetched) {
      if (Number.isFinite(item.uid) && item.uid >= maxUidFetchedPlusOne) {
        maxUidFetchedPlusOne = item.uid + 1
      }
      const normalized = await normalizeInboundImapMessage({
        rawMessage: item.rawBody,
        uid: item.uid,
        accountIdentifier: credentials.fromAddress,
        fallbackDate: item.internalDate,
      })
      messages.push(normalized)
    }

    // Pagination contract (review H1, 2026-05-26):
    // The server's UIDNEXT marks the highest UID +1 in the mailbox right now.
    // If we fetched `limit` messages and there are MORE messages between our
    // highest fetched UID and the server's UIDNEXT, advancing the cursor to
    // serverUidNext would skip them forever. Instead persist `min(fetchedTop, serverUidNext)`
    // and surface `hasMore: true` so the hub worker re-enqueues the poll to
    // continue draining.
    const drained =
      // empty page → nothing to drain
      fetched.length === 0 ||
      // fewer than `limit` returned → all unread mail drained
      fetched.length < limit ||
      // server UIDNEXT reached → fully caught up
      (serverUidNext !== undefined && maxUidFetchedPlusOne >= serverUidNext)

    const persistedUidNext = drained
      ? serverUidNext ?? maxUidFetchedPlusOne
      : maxUidFetchedPlusOne

    const nextChannelState: ImapChannelState = {
      uidValidity: folderState.uidValidity ?? previousUidValidity,
      uidNext: persistedUidNext,
      lastFolder: 'INBOX',
    }

    // The hub's polling worker re-reads cursor through `fetchHistory`. We embed the
    // next-poll state in `nextCursor` (base64-encoded JSON) so workers can persist
    // it onto `CommunicationChannel.channelState` without depending on a hub-specific
    // contract beyond the existing `HistoryPage` shape.
    const nextCursor = Buffer.from(JSON.stringify(nextChannelState)).toString('base64')
    return { messages, nextCursor, hasMore: !drained }
  }

  async resolveContact(input: ResolveContactInput): Promise<ContactHint | null> {
    if (!input.senderIdentifier) return null
    if (input.senderIdentifier.includes('@')) {
      return {
        email: input.senderIdentifier,
        displayName: input.senderDisplayName,
      }
    }
    return null
  }
}

function parseCredentialsOrThrow(value: unknown): ImapCredentials {
  const parsed = imapCredentialsSchema.safeParse(value)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`Invalid IMAP credentials: ${first?.message ?? 'unknown validation error'}`)
  }
  return parsed.data
}

function pickRawMimeBuffer(raw: InboundMessage): Buffer {
  const candidate = raw.raw as { rawBody?: unknown; mime?: unknown }
  const value = candidate?.rawBody ?? candidate?.mime ?? raw.raw
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'utf-8')
  throw new Error('IMAP normalizeInbound requires `raw.rawBody` to be a Buffer or string MIME payload')
}

function pickAccountIdentifier(raw: InboundMessage): string {
  const candidate = raw.raw as { accountIdentifier?: unknown }
  const id = typeof candidate?.accountIdentifier === 'string' ? candidate.accountIdentifier : undefined
  return id ?? 'unknown@imap'
}

function pickUid(raw: InboundMessage): number | undefined {
  const candidate = raw.raw as { uid?: unknown }
  return typeof candidate?.uid === 'number' ? candidate.uid : undefined
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.length > 0) {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

let cachedAdapter: ImapChannelAdapter | null = null

export function getImapChannelAdapter(): ImapChannelAdapter {
  if (!cachedAdapter) cachedAdapter = new ImapChannelAdapter()
  return cachedAdapter
}

export { ImapChannelAdapter }
