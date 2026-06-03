import type {
  ChannelAdapter,
  ConvertOutboundInput,
  ChannelNativeContent,
  FetchHistoryInput,
  GetMessageStatusInput,
  HistoryPage,
  ImportHistoryInput,
  ImportHistoryPage,
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
import { emailResolveContact } from '@open-mercato/core/modules/communication_channels/lib/email-contact'
import { decodeCursor, encodeCursor } from '@open-mercato/core/modules/communication_channels/lib/email-mime'

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

    // Reject attachments at the boundary BEFORE building the MIME body. The hub
    // passes attachments as URL pointers; until the IMAP/SMTP adapter wires a
    // fetcher (with size + content-type validation), inlining them is unsafe —
    // a 0-byte attachment looks "delivered" but conveys nothing. Checking here
    // (rather than after conversion) avoids wasted MIME-build work and surfaces
    // the clearer "attachments unsupported" error even when recipients are also
    // missing. Documented in review M2 (2026-05-26) and tracked as a follow-up.
    if (Array.isArray(input.content.attachments) && input.content.attachments.length > 0) {
      return {
        externalMessageId: '',
        status: 'failed',
        error:
          '[internal] IMAP/SMTP adapter does not yet support attachments. Send the message without attachments or use a provider that supports them (Gmail).',
      }
    }

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
      return { externalMessageId: '', status: 'failed', error: '[internal] Email send requires at least one recipient' }
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
      // Skip when the RFC2822 bytes are empty (MailComposer build failed upstream):
      // appending a 0-byte buffer would create a corrupt Sent-folder entry, and the
      // send itself already succeeded.
      if (result.raw.length > 0) {
        await imap.appendSent(credentialsToConnection(credentials), result.raw)
      }
    } catch (appendError) {
      // Best-effort: many servers auto-store sent mail via Submission, and the
      // Sent mailbox name is provider-specific (localized, or "[Gmail]/Sent Mail").
      // Log so operators can diagnose missing Sent-folder archival rather than
      // failing the send.
      console.warn(
        '[internal] channel_imap: failed to append outbound message to Sent folder:',
        appendError instanceof Error ? appendError.message : appendError,
      )
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
    const channelState = imapChannelStateSchema.parse(input.channelState ?? {}) satisfies ImapChannelState
    const imap = getImapClient()
    const connection = credentialsToConnection(credentials)

    // Spec B § Bounded, cursor-driven IMAP inbound:
    //   - Bootstrap (no cursor): SELECT INBOX, persist UIDVALIDITY + UIDNEXT,
    //     return ZERO messages. Backlog import happens via the explicit
    //     `/import-history` endpoint, not via the silent connect flow.
    //   - Incremental (cursor exists): UID FETCH `previousUidNext:*`, capped
    //     at HARD_CAP = 200. If more available, set `hasMore: true` so the
    //     hub re-enqueues immediately and drains the backlog.
    //   - UIDVALIDITY mismatch: discard cursor and treat as bootstrap (the
    //     mailbox was recreated or renamed; we cannot trust the prior cursor).
    const folderState = await imap.selectInbox(connection)
    const previousUidValidity = toNumberOrUndefined(channelState.uidValidity)
    const previousUidNext = toNumberOrUndefined(channelState.uidNext)
    const serverUidNext = toNumberOrUndefined(folderState.uidNext)
    const HARD_CAP = clampHardCap(input.limit)

    const uidValidityMismatch =
      previousUidValidity !== undefined &&
      folderState.uidValidity !== undefined &&
      folderState.uidValidity !== previousUidValidity
    if (uidValidityMismatch) {
      console.warn(
        '[channel-imap] UIDVALIDITY changed for INBOX (was %s, now %s) — discarding cursor and re-bootstrapping',
        previousUidValidity,
        folderState.uidValidity,
      )
    }
    const needsBootstrap =
      uidValidityMismatch || previousUidNext === undefined || previousUidNext === null

    let fetched: { uid: number; rawBody: Buffer; internalDate?: Date; flags?: string[] }[]
    let hasMore = false
    if (needsBootstrap) {
      // ── Bootstrap: persist cursor only, fetch zero messages ─────────────
      // Spec B § Bootstrap. The "1M inbox" failure mode is fixed by
      // construction: a fresh user sees zero history until they explicitly
      // request `/import-history`. Set `hasMore: false` so the poll worker
      // does NOT immediately re-enqueue.
      fetched = []
      hasMore = false
    } else if (previousUidNext !== undefined && serverUidNext !== undefined && previousUidNext >= serverUidNext) {
      // ── Idle: UIDNEXT did not advance, so there is no new mail ──────────
      // Skip the FETCH entirely. IMAP `<n>:*` always matches at least the
      // highest existing UID, so an idle mailbox would otherwise re-fetch and
      // re-normalize one already-ingested message every tick. The cursor is
      // retained downstream (an empty fetch does not advance it).
      fetched = []
      hasMore = false
    } else {
      // ── Incremental: UID FETCH previousUidNext:* up to HARD_CAP ─────────
      // On a mature mailbox this is typically 0-N UIDs. The HARD_CAP bounds
      // the per-poll wall-clock + DB transaction size; if more remain, the
      // hub re-enqueues us immediately via `hasMore: true`.
      const range = `${previousUidNext}:*`
      // Fetch up to HARD_CAP + 1 so we can detect whether more remain
      // without paying for an extra round-trip later.
      const probeLimit = HARD_CAP + 1
      const raw = await imap.fetchUidRange(connection, range, { limit: probeLimit })
      if (raw.length > HARD_CAP) {
        fetched = raw.slice(0, HARD_CAP)
        hasMore = true
      } else {
        fetched = raw
        hasMore = false
      }
    }

    const messages: NormalizedInboundMessage[] = []
    for (const item of fetched) {
      const normalized = await normalizeInboundImapMessage({
        rawMessage: item.rawBody,
        uid: item.uid,
        accountIdentifier: credentials.fromAddress,
        fallbackDate: item.internalDate,
      })
      messages.push(normalized)
    }

    // Cursor advancement contract:
    //   - Bootstrap: persist the server's current UIDNEXT so the next poll
    //     becomes incremental from this point onward (intentionally skips the
    //     pre-existing backlog; use `/import-history` to pull it).
    //   - Incremental: persist `highestFetchedUid + 1` — NEVER the server's
    //     UIDNEXT. When `fetched` is empty we retain `previousUidNext` so the
    //     next poll resumes from the same point.
    const advancedUidNext = (() => {
      if (needsBootstrap) return serverUidNext
      if (fetched.length === 0) return previousUidNext
      const highest = fetched.reduce((max, item) => (item.uid > max ? item.uid : max), 0)
      // Anchor the cursor to the highest UID we ACTUALLY fetched — never to the
      // server's UIDNEXT. Providers like Gmail report a UIDNEXT that runs ahead
      // of the highest message currently in the folder (UID gaps from
      // labels/threads, or a message materialising into INBOX at a UID below
      // UIDNEXT). Jumping the cursor to `serverUidNext` then steps over any
      // INBOX message that sits below it: that message lands permanently below
      // the cursor and is never fetched again — the bug that silently dropped
      // inbound replies (UID 61979 skipped while cursor jumped to 61981).
      // `highest + 1` guarantees we never step over an unfetched message; if the
      // server's UIDNEXT is higher, the next poll just re-scans `highest+1:*`
      // (idempotent — the hub dedups on (channel_id, external_message_id)).
      return highest + 1
    })()
    const nextChannelState: ImapChannelState = {
      uidValidity: folderState.uidValidity ?? previousUidValidity,
      uidNext: advancedUidNext,
      lastFolder: 'INBOX',
    }

    // The hub's polling worker re-reads cursor through `fetchHistory`. We embed the
    // next-poll state in `nextCursor` (base64-encoded JSON) so workers can persist
    // it onto `CommunicationChannel.channelState` without depending on a hub-specific
    // contract beyond the existing `HistoryPage` shape.
    const nextCursor = encodeCursor(nextChannelState)
    return { messages, nextCursor, hasMore }
  }

  async importHistory(input: ImportHistoryInput): Promise<ImportHistoryPage> {
    const credentials = parseCredentialsOrThrow(input.credentials)
    const connection = credentialsToConnection(credentials)
    const imap = getImapClient()

    const sinceDaysRaw = Number.isFinite(input.sinceDays) ? Math.trunc(input.sinceDays) : 30
    const sinceDays = Math.max(1, Math.min(365, sinceDaysRaw))
    const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)

    const maxMessagesRaw = Number.isFinite(input.maxMessages) ? Math.trunc(input.maxMessages as number) : 1000
    const maxMessages = Math.max(1, Math.min(5000, maxMessagesRaw))

    const PAGE_SIZE = clampHardCap(undefined)

    // Resume previous page or perform initial SEARCH on first call. The cursor
    // encodes the full remaining UID list discovered server-side so subsequent
    // pages don't re-issue SEARCH (which on large mailboxes is expensive).
    let allUids: number[]
    let remainingUids: number[]
    let collectedSoFar: number
    let totalCandidates: number | undefined
    const cursor = decodeImportCursor(input.cursor)
    if (cursor) {
      remainingUids = cursor.remaining
      collectedSoFar = cursor.collected
      totalCandidates = cursor.total
      allUids = cursor.remaining
    } else {
      // FROM-chunking: SEARCH with very long OR chains can blow imapflow's
      // tag-buffer; chunk to ≤30 senders and union the results. When
      // contactEmails is empty we issue a single SINCE-only search.
      const senders = (input.contactEmails ?? []).filter((s): s is string => typeof s === 'string' && s.includes('@'))
      const uidSet = new Set<number>()
      if (senders.length === 0) {
        const uids = await imap.searchUidsByFromAndSince(connection, { sinceDate })
        for (const uid of uids) uidSet.add(uid)
      } else {
        const CHUNK_SIZE = 30
        for (let i = 0; i < senders.length; i += CHUNK_SIZE) {
          const chunk = senders.slice(i, i + CHUNK_SIZE)
          const uids = await imap.searchUidsByFromAndSince(connection, { fromAddresses: chunk, sinceDate })
          for (const uid of uids) uidSet.add(uid)
        }
      }
      // Process newest first (highest UIDs ~= most recent on standard servers).
      allUids = Array.from(uidSet).sort((a, b) => b - a).slice(0, maxMessages)
      remainingUids = allUids
      collectedSoFar = 0
      totalCandidates = allUids.length
    }

    if (remainingUids.length === 0) {
      return { messages: [], hasMore: false, totalCandidates }
    }

    const batchUids = remainingUids.slice(0, PAGE_SIZE)
    const stillRemaining = remainingUids.slice(PAGE_SIZE)
    const uidSetExpression = batchUids.join(',')
    const fetched = await imap.fetchUidRange(connection, uidSetExpression, { limit: PAGE_SIZE })

    const messages: NormalizedInboundMessage[] = []
    for (const item of fetched) {
      const normalized = await normalizeInboundImapMessage({
        rawMessage: item.rawBody,
        uid: item.uid,
        accountIdentifier: credentials.fromAddress,
        fallbackDate: item.internalDate,
      })
      messages.push(normalized)
    }

    const newCollected = collectedSoFar + messages.length
    const hasMore = stillRemaining.length > 0 && newCollected < maxMessages
    const nextCursor = hasMore
      ? encodeImportCursor({ remaining: stillRemaining, collected: newCollected, total: totalCandidates })
      : undefined

    return { messages, nextCursor, hasMore, totalCandidates }
  }

  async resolveContact(input: ResolveContactInput): Promise<ContactHint | null> {
    return emailResolveContact(input)
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
  throw new Error('[internal] IMAP normalizeInbound requires `raw.rawBody` to be a Buffer or string MIME payload')
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

/**
 * Spec B § HARD_CAP. Bound each poll's wall-clock + DB transaction size.
 * Honor the caller's `limit` hint but never exceed `HARD_CAP_MAX`. A
 * single poll will fetch at most this many UIDs; if more remain we set
 * `hasMore: true` and the hub re-enqueues immediately.
 *
 * Configurable via `OM_CHANNEL_IMAP_HARD_CAP_PER_POLL` (default 200).
 */
function clampHardCap(callerLimit: number | undefined): number {
  const envOverride = Number.parseInt(process.env.OM_CHANNEL_IMAP_HARD_CAP_PER_POLL ?? '', 10)
  const HARD_CAP_MAX = Number.isFinite(envOverride) && envOverride > 0 ? envOverride : 200
  if (typeof callerLimit === 'number' && callerLimit > 0) {
    return Math.min(callerLimit, HARD_CAP_MAX)
  }
  return HARD_CAP_MAX
}

interface ImportCursor {
  remaining: number[]
  collected: number
  total?: number
}

function encodeImportCursor(cursor: ImportCursor): string {
  return encodeCursor(cursor)
}

function decodeImportCursor(value: string | undefined): ImportCursor | null {
  const parsed = decodeCursor(value)
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as { remaining?: unknown; collected?: unknown; total?: unknown }
  const remaining = Array.isArray(obj.remaining)
    ? obj.remaining.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    : []
  const collected = typeof obj.collected === 'number' ? obj.collected : 0
  const total = typeof obj.total === 'number' ? obj.total : undefined
  return { remaining, collected, total }
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
