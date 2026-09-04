import type {
  BuildOAuthAuthorizeUrlInput,
  BuildOAuthAuthorizeUrlResult,
  ChannelAdapter,
  ChannelNativeContent,
  ContactHint,
  ConvertOutboundInput,
  DeleteChannelMessageInput,
  ExchangeOAuthCodeInput,
  ExchangeOAuthCodeResult,
  FetchHistoryInput,
  GetMessageStatusInput,
  HistoryPage,
  ImportHistoryInput,
  ImportHistoryPage,
  InboundMessage,
  MessageStatus,
  NormalizedInboundMessage,
  RefreshCredentialsInput,
  RefreshedCredentials,
  ResolveContactInput,
  SendMessageInput,
  SendMessageResult,
  VerifyWebhookInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { emailResolveContact } from '@open-mercato/core/modules/communication_channels/lib/email-contact'
import { decodeCursor, encodeCursor, ensureBrackets, htmlToText } from '@open-mercato/core/modules/communication_channels/lib/email-mime'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { ms365Capabilities } from './capabilities'
import {
  MS365_DEFAULT_TENANT,
  ms365ChannelStateSchema,
  ms365ClientCredentialsSchema,
  ms365UserCredentialsSchema,
  parseScopes,
  type Ms365ChannelState,
  type Ms365ClientCredentials,
  type Ms365UserCredentials,
} from './credentials'
import { convertOutboundForMs365, type Ms365EmailNativeMetadata } from './convert-outbound'
import {
  escapeODataString,
  getGraphMailClient,
  GraphApiError,
  isResyncRequiredError,
  resolveGraphPageSize,
  type GraphAuth,
  type GraphDeltaPage,
  type GraphMailClient,
  type GraphMessageStub,
} from './graph-client'
import { normalizeInboundMs365Message } from './normalize-inbound'
import {
  decodeIdTokenClaims,
  generatePkcePair,
  getMicrosoftOAuthClient,
  tokenResponseToExpiresAt,
} from './oauth'

const logger = createLogger('channel_ms365')

/**
 * Protocol sentinel the hub keys on (see `communication_channels`
 * `error-classification.isReauthError`) — never prefix, translate, or wrap it.
 */
const REQUIRES_REAUTH = 'requires_reauth'

/**
 * How far back the bootstrap delta looks. A mail received a second before the
 * delta token is minted is neither in a `receivedDateTime ge now` initial page
 * nor in any later change page (it never changes again), so a zero-width
 * bootstrap would lose it. Two minutes of overlap closes that race at the cost
 * of ingesting at most two minutes of already-present mail on connect; the
 * hub dedups by message id.
 */
const BOOTSTRAP_OVERLAP_MS = 2 * 60_000

/** Graph `$filter` length is bounded; chunk sender lists into OR groups of this size. */
const IMPORT_SENDER_CHUNK_SIZE = 15

/** Well-known folder id accepted by `POST /me/messages/{id}/move`. */
const DELETED_ITEMS_FOLDER = 'deleteditems'

/**
 * Graph error codes that mean the mailbox cannot be used at all (no licence,
 * REST disabled, consent missing). Permanent — never retried.
 */
const PERMANENT_ACCESS_ERROR_CODES = new Set([
  'erroraccessdenied',
  'mailboxnotenabledforrestapi',
  'errorinvaliduser',
  'resourcenotfound',
])

type ImportCursor = {
  nextLink?: string
  chunkIndex: number
  fetched: number
}

/**
 * Microsoft 365 `ChannelAdapter`. OAuth2 (Entra ID v2.0 + PKCE), polling-driven
 * through the Graph Inbox delta query (`realtimePush: false`).
 *
 * Credential shapes:
 *   - Per-user (`IntegrationCredentials` at user scope): `{ accessToken,
 *     refreshToken?, expiresAt?, scopes?, email?, displayName?, tenantId? }`.
 *   - Tenant OAuth client config (`IntegrationCredentials` at tenant scope for
 *     `channel_ms365`): `{ clientId, clientSecret, tenantId?, scopes? }`. The hub
 *     resolves it and hands it to `buildOAuthAuthorizeUrl` / `exchangeOAuthCode`
 *     as `credentials`, and to `refreshCredentials` as `oauthClient`.
 *
 * Sync model (spec § Inbound sync model):
 *   - Bootstrap: start an Inbox delta filtered to the last `BOOTSTRAP_OVERLAP_MS`,
 *     drain to a deltaLink, persist `{ deltaLink, receivedWatermark }`.
 *   - Incremental: follow `nextLink` (mid-drain) or `deltaLink`; ingest only
 *     non-draft, non-tombstone items with `receivedDateTime >= receivedWatermark`
 *     (older items are flag/move updates on mail we already have).
 *   - The stored link only advances after every message of the page was
 *     normalized; a transient failure keeps the previous link so the next tick
 *     re-reads the same page (hub dedups by message id).
 *   - `410 Gone` / `syncStateNotFound`: re-bootstrap from `receivedWatermark`.
 */
class Ms365ChannelAdapter implements ChannelAdapter {
  readonly providerKey = 'ms365'
  readonly channelType = 'email'
  readonly capabilities = ms365Capabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    if (!userCredentials.email) {
      return {
        externalMessageId: '',
        status: 'failed',
        error: 'Microsoft 365 channel has no mailbox address; reconnect the channel.',
      }
    }
    let native: ChannelNativeContent
    try {
      native = await convertOutboundForMs365({
        body: input.content.html ?? input.content.text ?? '',
        bodyFormat: input.content.bodyFormat ?? (input.content.html ? 'html' : 'text'),
        attachments: input.content.attachments,
        channelMetadata: input.metadata,
        fromAddress: userCredentials.email,
        fromName: userCredentials.displayName,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outbound conversion failed'
      return { externalMessageId: '', status: 'failed', error: message }
    }

    const nativeMeta = native.metadata as unknown as Ms365EmailNativeMetadata
    const api = getGraphMailClient()
    const auth: GraphAuth = { accessToken: userCredentials.accessToken }

    let draftId: string
    let internetMessageId: string | undefined
    let conversationId: string | undefined
    try {
      const draft = await api.createDraftFromMime(auth, nativeMeta.rawMessage)
      draftId = draft.id
      internetMessageId = draft.internetMessageId
      conversationId = draft.conversationId
    } catch (error) {
      return failedSendResult(error, 'Microsoft 365 draft creation failed')
    }

    try {
      await api.sendDraft(auth, draftId)
    } catch (error) {
      if (!(error instanceof GraphApiError && (error.status === 401 || error.transient))) {
        // Permanent send failure: remove the draft so the user's Drafts folder
        // does not accumulate orphans. Best-effort — the send already failed.
        try {
          await api.deleteMessage(auth, draftId)
        } catch (cleanupError) {
          logger.warn('failed to delete orphaned draft after send failure', { err: cleanupError })
        }
      }
      return failedSendResult(error, 'Microsoft 365 send failed')
    }

    const externalMessageId = stripAngleBrackets(internetMessageId) ?? stripAngleBrackets(nativeMeta.messageId) ?? draftId
    return {
      externalMessageId,
      conversationId: input.conversationId,
      status: 'sent',
      metadata: {
        graphMessageId: draftId,
        graphConversationId: conversationId,
        internetMessageId: internetMessageId ?? nativeMeta.messageId,
      },
    }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    // Polling provider — no inbound webhook in phase 1 (Graph change
    // notifications are phase 2). Return an unhandled event so the generic
    // route acknowledges without enqueuing any tenant-scoped work.
    return { raw: {}, eventType: 'other', metadata: { reason: 'ms365-uses-polling-not-push' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    // Graph exposes no per-message delivery-status API; mirror Gmail/IMAP.
    return { status: 'sent' }
  }

  async convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
    // The hub calls this before it knows the recipients (test-send passes them
    // only on `sendMessage.metadata`), so shape the body here and defer the
    // RFC2822 assembly — which needs From/To — to `sendMessage`.
    const html = input.bodyFormat === 'html' ? input.body : undefined
    const text = input.bodyFormat === 'html' ? htmlToText(input.body) : input.body
    return {
      content: {
        text,
        html,
        bodyFormat: input.bodyFormat,
        attachments: input.attachments,
        raw: { ...(input.channelMetadata ?? {}) },
      },
    }
  }

  async normalizeInbound(raw: InboundMessage): Promise<NormalizedInboundMessage> {
    const payload = raw.raw as {
      rawBase64?: unknown
      rawBody?: unknown
      graphMessageId?: unknown
      graphConversationId?: unknown
      internetMessageId?: unknown
      accountIdentifier?: unknown
    }
    const rawMessage = pickRawMimeBuffer(payload)
    return normalizeInboundMs365Message({
      rawMessage,
      graphMessageId: typeof payload.graphMessageId === 'string' ? payload.graphMessageId : 'unknown',
      graphConversationId: typeof payload.graphConversationId === 'string' ? payload.graphConversationId : undefined,
      internetMessageId: typeof payload.internetMessageId === 'string' ? payload.internetMessageId : undefined,
      accountIdentifier: typeof payload.accountIdentifier === 'string' ? payload.accountIdentifier : 'unknown@ms365',
    })
  }

  async buildOAuthAuthorizeUrl(input: BuildOAuthAuthorizeUrlInput): Promise<BuildOAuthAuthorizeUrlResult> {
    const client = parseClientCredentialsOrThrow(input.credentials)
    const scopes = parseScopes(client.scopes)
    const pkce = generatePkcePair()
    const url = getMicrosoftOAuthClient().buildAuthorizeUrl({
      clientId: client.clientId,
      tenantId: client.tenantId,
      redirectUri: input.redirectUri,
      state: input.state,
      scopes,
      codeChallenge: pkce.challenge,
      loginHint: input.loginHint,
    })
    // The verifier travels in the hub's encrypted state cookie and comes back
    // as `stateExtra` on the callback (spec § OAuth flow).
    return { authorizeUrl: url, extra: { codeVerifier: pkce.verifier, scopes, tenantId: client.tenantId } }
  }

  async exchangeOAuthCode(input: ExchangeOAuthCodeInput): Promise<ExchangeOAuthCodeResult> {
    const client = parseClientCredentialsOrThrow(input.credentials)
    const extra = (input.stateExtra ?? {}) as { codeVerifier?: unknown; scopes?: unknown; tenantId?: unknown }
    const codeVerifier = typeof extra.codeVerifier === 'string' ? extra.codeVerifier : ''
    if (!codeVerifier) {
      throw new Error('[internal] Microsoft 365 OAuth callback is missing the PKCE verifier from the initiate step')
    }
    const scopes = Array.isArray(extra.scopes)
      ? extra.scopes.filter((value): value is string => typeof value === 'string')
      : parseScopes(client.scopes)
    const authorityTenant = typeof extra.tenantId === 'string' && extra.tenantId ? extra.tenantId : client.tenantId

    const oauth = getMicrosoftOAuthClient()
    const token = await oauth.exchangeCode({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      tenantId: authorityTenant,
      redirectUri: input.redirectUri,
      code: input.code,
      codeVerifier,
      scopes,
    })

    const claims = decodeIdTokenClaims(token.id_token)
    let email: string | undefined
    let displayName: string | undefined
    try {
      const profile = await oauth.fetchProfile(token.access_token)
      email = normalizeEmail(profile.mail) ?? normalizeEmail(profile.userPrincipalName)
      displayName = profile.displayName ?? undefined
    } catch (error) {
      // Non-fatal: fall back to the id_token claims for the mailbox identity.
      logger.warn('Microsoft Graph profile lookup failed; falling back to id_token claims', { err: error })
    }
    email = email ?? normalizeEmail(claims?.preferred_username) ?? normalizeEmail(claims?.email)
    displayName = displayName ?? claims?.name ?? email

    const expiresAt = tokenResponseToExpiresAt(token)
    const credentials: Ms365UserCredentials = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: expiresAt?.toISOString(),
      scopes: token.scope ? token.scope.split(' ').filter(Boolean) : scopes,
      email,
      displayName,
      // Refreshes go to the user's home directory so they keep working even
      // when the admin later changes the configured alias.
      tenantId: claims?.tid ?? authorityTenant,
    }
    return {
      credentials: credentials as unknown as Record<string, unknown>,
      externalIdentifier: email,
      displayName: displayName ?? email,
      expiresAt,
    }
  }

  async refreshCredentials(input: RefreshCredentialsInput): Promise<RefreshedCredentials> {
    const current = parseUserCredentialsOrThrow(input.credentials)
    if (!current.refreshToken) {
      throw new Error(REQUIRES_REAUTH)
    }
    const client = resolveMs365OAuthClient(input)
    let token
    try {
      token = await getMicrosoftOAuthClient().refreshToken({
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        tenantId: current.tenantId ?? client.tenantId,
        refreshToken: current.refreshToken,
        scopes: parseScopes(client.scopes),
      })
    } catch (error) {
      // `invalid_grant` = refresh token revoked/expired (90-day inactivity,
      // password change, admin revocation). Surface the sentinel so the hub
      // flips the channel instead of retrying forever.
      if (error instanceof Error && /invalid_grant|interaction_required|AADSTS7000|AADSTS50173/i.test(error.message)) {
        throw new Error(REQUIRES_REAUTH)
      }
      throw error
    }
    const expiresAt = tokenResponseToExpiresAt(token)
    const refreshed: Ms365UserCredentials = {
      ...current,
      accessToken: token.access_token,
      // Entra rotates the refresh token on every refresh — persist the new one.
      refreshToken: token.refresh_token ?? current.refreshToken,
      expiresAt: expiresAt?.toISOString(),
      scopes: token.scope ? token.scope.split(' ').filter(Boolean) : current.scopes,
    }
    return {
      credentials: refreshed as unknown as Record<string, unknown>,
      expiresAt,
    }
  }

  async fetchHistory(input: FetchHistoryInput): Promise<HistoryPage> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    const state = ms365ChannelStateSchema.parse(input.channelState ?? {})
    const auth: GraphAuth = { accessToken: userCredentials.accessToken }
    const api = getGraphMailClient()
    const pageSize = resolveGraphPageSize(input.limit)
    const accountIdentifier = userCredentials.email ?? 'unknown@ms365'

    const link = state.nextLink ?? state.deltaLink
    if (!link) {
      return this.bootstrapDelta(api, auth, pageSize, state.receivedWatermark, accountIdentifier)
    }

    let page: GraphDeltaPage
    try {
      page = await api.continueDelta(auth, link, pageSize)
    } catch (error) {
      if (isResyncRequiredError(error)) {
        // Delta token expired — resume from the watermark so nothing received
        // while the token was dead is skipped (spec § Inbound sync model).
        logger.warn('Microsoft Graph delta token expired; re-syncing Inbox from watermark', {
          receivedWatermark: state.receivedWatermark,
        })
        return this.bootstrapDelta(api, auth, pageSize, state.receivedWatermark, accountIdentifier, { ingest: true })
      }
      throw toHubError(error)
    }

    return this.ingestDeltaPage(api, auth, page, state, accountIdentifier)
  }

  async importHistory(input: ImportHistoryInput): Promise<ImportHistoryPage> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    const auth: GraphAuth = { accessToken: userCredentials.accessToken }
    const api = getGraphMailClient()
    const accountIdentifier = userCredentials.email ?? 'unknown@ms365'
    const maxMessages = Math.max(1, input.maxMessages ?? 1000)
    const pageSize = resolveGraphPageSize()

    const cursor = decodeImportCursor(input.cursor)
    if (cursor.fetched >= maxMessages) {
      return { messages: [], hasMore: false }
    }

    const senderChunks = chunkSenders(input.contactEmails)
    if (cursor.chunkIndex >= senderChunks.length) {
      return { messages: [], hasMore: false }
    }

    const sinceDays = Math.min(Math.max(1, Math.floor(input.sinceDays)), 365)
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)

    let page
    try {
      if (cursor.nextLink) {
        page = await api.continueList(auth, cursor.nextLink)
      } else {
        page = await api.listInboxMessages(auth, {
          filter: buildImportFilter(since, senderChunks[cursor.chunkIndex]),
          top: pageSize,
          orderBy: 'receivedDateTime desc',
          includeCount: cursor.chunkIndex === 0 && senderChunks.length === 1,
        })
      }
    } catch (error) {
      throw toHubError(error)
    }

    const remaining = maxMessages - cursor.fetched
    const candidates = page.value.filter((item) => !item.isDraft).slice(0, remaining)
    const { messages, hardFailed } = await this.fetchAndNormalize(api, auth, candidates, accountIdentifier)
    const fetched = cursor.fetched + messages.length

    if (hardFailed) {
      // Re-run the same page next time; already-ingested messages dedup at the hub.
      return {
        messages,
        nextCursor: encodeCursor({ nextLink: cursor.nextLink, chunkIndex: cursor.chunkIndex, fetched } satisfies ImportCursor),
        hasMore: true,
        totalCandidates: page.count,
      }
    }

    const capped = fetched >= maxMessages
    if (page.nextLink && !capped) {
      return {
        messages,
        nextCursor: encodeCursor({ nextLink: page.nextLink, chunkIndex: cursor.chunkIndex, fetched } satisfies ImportCursor),
        hasMore: true,
        totalCandidates: page.count,
      }
    }
    const nextChunk = cursor.chunkIndex + 1
    if (nextChunk < senderChunks.length && !capped) {
      return {
        messages,
        nextCursor: encodeCursor({ chunkIndex: nextChunk, fetched } satisfies ImportCursor),
        hasMore: true,
        totalCandidates: page.count,
      }
    }
    return { messages, hasMore: false, totalCandidates: page.count }
  }

  async deleteMessage(input: DeleteChannelMessageInput): Promise<void> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    const auth: GraphAuth = { accessToken: userCredentials.accessToken }
    const api = getGraphMailClient()
    // "Delete" is delivered as a move to Deleted Items so an accidental click is
    // recoverable from Outlook, mirroring Gmail's trash semantics.
    let graphId: string | null
    try {
      graphId = await api.findMessageIdByInternetMessageId(auth, ensureBrackets(input.externalMessageId))
    } catch (error) {
      throw toHubError(error)
    }
    if (!graphId) return
    try {
      await api.moveMessage(auth, graphId, DELETED_ITEMS_FOLDER)
    } catch (error) {
      if (error instanceof GraphApiError && error.status === 404) return
      throw toHubError(error)
    }
  }

  async resolveContact(input: ResolveContactInput): Promise<ContactHint | null> {
    return emailResolveContact(input)
  }

  /**
   * Start a fresh Inbox delta. Without `ingest`, only the cursor is seeded
   * (first connect: no back-fill beyond the overlap window). With `ingest`
   * (re-sync after an expired token) every item since the watermark is
   * normalized so nothing received while the token was dead is lost.
   */
  private async bootstrapDelta(
    api: GraphMailClient,
    auth: GraphAuth,
    pageSize: number,
    previousWatermark: string | undefined,
    accountIdentifier: string,
    options: { ingest?: boolean } = {},
  ): Promise<HistoryPage> {
    const previous = parseIsoDate(previousWatermark)
    const floor = previous ?? new Date(Date.now() - BOOTSTRAP_OVERLAP_MS)
    let page: GraphDeltaPage
    try {
      page = await api.startInboxDelta(auth, { receivedSince: floor, pageSize })
    } catch (error) {
      throw toHubError(error)
    }
    const seededState: Ms365ChannelState = {
      receivedWatermark: floor.toISOString(),
    }
    if (!options.ingest) {
      // First connect: walk to the deltaLink without normalizing so the channel
      // starts from "now" (the overlap window is re-read on the first
      // incremental tick through the watermark rule).
      let current = page
      while (!current.deltaLink && current.nextLink) {
        try {
          current = await api.continueDelta(auth, current.nextLink, pageSize)
        } catch (error) {
          throw toHubError(error)
        }
      }
      const nextState: Ms365ChannelState = {
        ...seededState,
        deltaLink: current.deltaLink,
        lastSyncedAt: new Date().toISOString(),
      }
      return { messages: [], nextCursor: encodeCursor(nextState), hasMore: false }
    }
    return this.ingestDeltaPage(api, auth, page, seededState, accountIdentifier)
  }

  /**
   * Normalize one delta page and compute the next persisted state. The link
   * only advances when every candidate on the page was fetched; a transient
   * `$value` failure keeps the incoming state so the next tick re-reads the
   * same page.
   */
  private async ingestDeltaPage(
    api: GraphMailClient,
    auth: GraphAuth,
    page: GraphDeltaPage,
    state: Ms365ChannelState,
    accountIdentifier: string,
  ): Promise<HistoryPage> {
    const watermark = parseIsoDate(state.receivedWatermark)
    const candidates = page.value.filter((item) => isIngestCandidate(item, watermark))
    const { messages, hardFailed } = await this.fetchAndNormalize(api, auth, candidates, accountIdentifier)
    const now = new Date().toISOString()

    if (hardFailed) {
      const pinned: Ms365ChannelState = { ...state, lastSyncedAt: now }
      return { messages, nextCursor: encodeCursor(pinned), hasMore: true }
    }

    const seenMax = maxReceivedDateTime(candidates)
    const pendingMax = laterIso(state.pendingWatermark, seenMax)

    if (page.deltaLink) {
      const nextState: Ms365ChannelState = {
        deltaLink: page.deltaLink,
        receivedWatermark: laterIso(state.receivedWatermark, pendingMax) ?? state.receivedWatermark,
        lastSyncedAt: now,
      }
      return { messages, nextCursor: encodeCursor(nextState), hasMore: false }
    }

    const nextState: Ms365ChannelState = {
      deltaLink: state.deltaLink,
      nextLink: page.nextLink,
      receivedWatermark: state.receivedWatermark,
      pendingWatermark: pendingMax,
      lastSyncedAt: now,
    }
    return { messages, nextCursor: encodeCursor(nextState), hasMore: Boolean(page.nextLink) }
  }

  /**
   * Fetch + normalize each candidate. 404/410 on `$value` means the message
   * is gone — skip it. Any other failure stops the page without advancing
   * past the unprocessed messages (`hardFailed: true`); a 401 is re-thrown so
   * the hub flips the channel to `requires_reauth`.
   */
  private async fetchAndNormalize(
    api: GraphMailClient,
    auth: GraphAuth,
    stubs: GraphMessageStub[],
    accountIdentifier: string,
  ): Promise<{ messages: NormalizedInboundMessage[]; hardFailed: boolean }> {
    const out: NormalizedInboundMessage[] = []
    for (const stub of stubs) {
      let rawMessage: Buffer
      try {
        rawMessage = await api.getMessageMime(auth, stub.id)
      } catch (error) {
        if (error instanceof GraphApiError && (error.status === 404 || error.status === 410)) continue
        if (error instanceof GraphApiError && error.status === 401) throw toHubError(error)
        logger.warn('Microsoft Graph message fetch failed; pinning cursor for retry', {
          graphMessageId: stub.id,
          err: error,
        })
        return { messages: out, hardFailed: true }
      }
      const normalized = await normalizeInboundMs365Message({
        rawMessage,
        graphMessageId: stub.id,
        graphConversationId: stub.conversationId,
        internetMessageId: stub.internetMessageId,
        accountIdentifier,
        fallbackDate: parseIsoDate(stub.receivedDateTime) ?? undefined,
      })
      out.push(normalized)
    }
    return { messages: out, hardFailed: false }
  }
}

// ── helpers ──────────────────────────────────────────────────

function isIngestCandidate(item: GraphMessageStub, watermark: Date | null): boolean {
  if (!item || typeof item.id !== 'string' || item.id.length === 0) return false
  if (item['@removed']) return false
  if (item.isDraft) return false
  if (!watermark) return true
  const received = parseIsoDate(item.receivedDateTime)
  // Items without a timestamp cannot be classified; ingest them (dedup at hub)
  // rather than silently dropping mail.
  if (!received) return true
  return received.getTime() >= watermark.getTime()
}

function maxReceivedDateTime(items: GraphMessageStub[]): string | undefined {
  let max: Date | null = null
  for (const item of items) {
    const received = parseIsoDate(item.receivedDateTime)
    if (received && (!max || received.getTime() > max.getTime())) max = received
  }
  return max ? max.toISOString() : undefined
}

function laterIso(a: string | undefined, b: string | undefined): string | undefined {
  const dateA = parseIsoDate(a)
  const dateB = parseIsoDate(b)
  if (dateA && dateB) return dateA.getTime() >= dateB.getTime() ? dateA.toISOString() : dateB.toISOString()
  return dateA?.toISOString() ?? dateB?.toISOString()
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().toLowerCase()
  return trimmed.includes('@') ? trimmed : undefined
}

function stripAngleBrackets(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  const stripped = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed
  return stripped.length > 0 ? stripped : undefined
}

function pickRawMimeBuffer(payload: { rawBase64?: unknown; rawBody?: unknown }): Buffer {
  if (Buffer.isBuffer(payload.rawBody)) return payload.rawBody
  if (typeof payload.rawBody === 'string') return Buffer.from(payload.rawBody, 'utf-8')
  if (typeof payload.rawBase64 === 'string') return Buffer.from(payload.rawBase64, 'base64')
  throw new Error('[internal] Microsoft 365 inbound payload is missing the raw MIME body')
}

function chunkSenders(contactEmails: string[] | undefined): Array<string[] | undefined> {
  const addresses = Array.from(
    new Set((contactEmails ?? []).map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')).filter(Boolean)),
  )
  if (addresses.length === 0) return [undefined]
  const chunks: Array<string[] | undefined> = []
  for (let index = 0; index < addresses.length; index += IMPORT_SENDER_CHUNK_SIZE) {
    chunks.push(addresses.slice(index, index + IMPORT_SENDER_CHUNK_SIZE))
  }
  return chunks
}

/**
 * `receivedDateTime` must appear first in `$filter` when the request also
 * `$orderby`s it (Graph requirement). Sender addresses are OR'd into one group.
 */
export function buildImportFilter(since: Date, senders: string[] | undefined): string {
  const clauses = [`receivedDateTime ge ${since.toISOString()}`]
  if (senders && senders.length > 0) {
    const senderClause = senders
      .map((address) => `from/emailAddress/address eq '${escapeODataString(address)}'`)
      .join(' or ')
    clauses.push(`(${senderClause})`)
  }
  return clauses.join(' and ')
}

function decodeImportCursor(value: string | undefined): ImportCursor {
  const decoded = decodeCursor(value)
  if (!decoded || typeof decoded !== 'object') return { chunkIndex: 0, fetched: 0 }
  const record = decoded as Record<string, unknown>
  return {
    nextLink: typeof record.nextLink === 'string' && record.nextLink.length > 0 ? record.nextLink : undefined,
    chunkIndex: typeof record.chunkIndex === 'number' && record.chunkIndex >= 0 ? Math.floor(record.chunkIndex) : 0,
    fetched: typeof record.fetched === 'number' && record.fetched >= 0 ? Math.floor(record.fetched) : 0,
  }
}

function failedSendResult(error: unknown, fallback: string): SendMessageResult {
  if (error instanceof GraphApiError && error.status === 401) {
    return { externalMessageId: '', status: 'failed', error: REQUIRES_REAUTH }
  }
  if (error instanceof GraphApiError) {
    // Keep the Graph error code visible to operators (e.g. ErrorSendAsDenied,
    // ErrorMessageSizeExceeded) — it is the actionable part of the failure.
    const withCode = error.code && !error.message.includes(error.code) ? `${error.message} [${error.code}]` : error.message
    return { externalMessageId: '', status: 'failed', error: withCode }
  }
  const message = error instanceof Error ? error.message : fallback
  return { externalMessageId: '', status: 'failed', error: message }
}

/**
 * Translate a Graph failure into what the hub's classifier expects: a 401 (or
 * an `invalid_grant`-style body) becomes the `requires_reauth` sentinel, a
 * permanent mailbox-access error is marked non-transient with an actionable
 * message, everything else passes through with its `status` / `transient`.
 */
function toHubError(error: unknown): Error {
  if (!(error instanceof GraphApiError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  if (error.status === 401) {
    return new Error(REQUIRES_REAUTH)
  }
  if (error.status === 403 && error.code && PERMANENT_ACCESS_ERROR_CODES.has(error.code.toLowerCase())) {
    const permanent = new GraphApiError(
      `Microsoft 365 mailbox is not accessible (${error.code}): check that the mailbox is licensed for Exchange Online, that Graph access is enabled, and that the app has Mail.ReadWrite / Mail.Send consent.`,
      error.status,
      error.detail,
      { code: error.code },
    )
    return permanent
  }
  return error
}

function parseUserCredentialsOrThrow(value: unknown): Ms365UserCredentials {
  const parsed = ms365UserCredentialsSchema.safeParse(value)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`Invalid Microsoft 365 credentials: ${first?.message ?? 'unknown validation error'}`)
  }
  return parsed.data
}

function parseClientCredentialsOrThrow(value: unknown): Ms365ClientCredentials {
  const parsed = ms365ClientCredentialsSchema.safeParse(value)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`Invalid Microsoft 365 OAuth client credentials: ${first?.message ?? 'unknown validation error'}`)
  }
  return parsed.data
}

let warnedLegacyClientPath = false

/**
 * Resolve the OAuth client config for a refresh, preferring the hub-resolved
 * `RefreshCredentialsInput.oauthClient` (Spec A). The deprecated
 * `credentials._client` read path is kept for parity with the Gmail adapter's
 * fixtures and emits a one-time warning.
 */
function resolveMs365OAuthClient(input: RefreshCredentialsInput): Ms365ClientCredentials {
  if (input.oauthClient) {
    const client = input.oauthClient
    if (!client.clientId) {
      throw new Error('[internal] Invalid Microsoft 365 OAuth client credentials: Application (client) ID required')
    }
    if (!client.clientSecret) {
      throw new Error('[internal] Invalid Microsoft 365 OAuth client credentials: client secret required')
    }
    return {
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      tenantId: MS365_DEFAULT_TENANT,
      ...(client.scopes !== undefined ? { scopes: client.scopes.join(' ') } : {}),
    }
  }
  if (!warnedLegacyClientPath) {
    warnedLegacyClientPath = true
    logger.warn(
      'reading OAuth client config from credentials._client is deprecated;' +
        ' pass via RefreshCredentialsInput.oauthClient instead (Spec A)',
    )
  }
  return parseClientCredentialsOrThrow(
    (input.credentials as unknown as { _client?: unknown })._client ?? input.credentials,
  )
}

let cachedAdapter: Ms365ChannelAdapter | null = null

export function getMs365ChannelAdapter(): ChannelAdapter {
  if (!cachedAdapter) cachedAdapter = new Ms365ChannelAdapter()
  return cachedAdapter
}
