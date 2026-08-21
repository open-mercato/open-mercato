import type {
  ApplyPushNotificationInput,
  ChannelAdapter,
  ChannelNativeContent,
  ConvertOutboundInput,
  BuildOAuthAuthorizeUrlInput,
  BuildOAuthAuthorizeUrlResult,
  DeleteChannelMessageInput,
  ExchangeOAuthCodeInput,
  ExchangeOAuthCodeResult,
  FetchHistoryInput,
  GetMessageStatusInput,
  HistoryPage,
  InboundMessage,
  MessageStatus,
  NormalizedInboundMessage,
  PushRegistration,
  RefreshCredentialsInput,
  RefreshedCredentials,
  RegisterPushInput,
  ResolveContactInput,
  ContactHint,
  SendMessageInput,
  SendMessageResult,
  UnregisterPushInput,
  VerifyWebhookInput,
} from '@open-mercato/core/modules/communication_channels/lib/adapter'
import { gmailCapabilities } from './capabilities'
import {
  gmailChannelStateSchema,
  gmailClientCredentialsSchema,
  gmailUserCredentialsSchema,
  parseScopes,
  type GmailChannelState,
  type GmailClientCredentials,
  type GmailUserCredentials,
} from './credentials'
import {
  decodeBase64Url,
  encodeBase64Url,
  getGmailApiClient,
  GmailApiError,
  type GmailGetMessageRawResponse,
} from './gmail-client'
import {
  getGoogleOAuthClient,
  tokenResponseToExpiresAt,
} from './oauth'
import {
  convertOutboundForGmail,
  type GmailEmailNativeMetadata,
} from './convert-outbound'
import { normalizeInboundGmailMessage } from './normalize-inbound'
import { emailResolveContact } from '@open-mercato/core/modules/communication_channels/lib/email-contact'
import { encodeCursor } from '@open-mercato/core/modules/communication_channels/lib/email-mime'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('channel_gmail')

/**
 * Gmail `ChannelAdapter`. OAuth2-based, polling-driven (`realtimePush: false`).
 *
 * Credential shape on `CommunicationChannel.credentials`:
 *   - Per-user: `{ accessToken, refreshToken?, expiresAt?, scopes?, email? }`
 *   - Tenant OAuth client config sits on `IntegrationCredentials.credentials`
 *     for the `gmail` provider: `{ clientId, clientSecret, scopes? }`. The hub
 *     looks it up by `(tenantId, providerKey='gmail')` and passes it to
 *     `buildOAuthAuthorizeUrl` + `exchangeOAuthCode` + `refreshCredentials`.
 *
 * Sync model:
 *   - First poll on a fresh channel reads `gmail.users.getProfile.historyId`
 *     and persists it; no message fetch is done on the bootstrap call (the
 *     existing inbox is intentionally not back-filled, matching the spec).
 *   - Subsequent polls call `gmail.users.history.list?startHistoryId=…` and
 *     fetch each `messagesAdded` entry's RAW payload.
 *   - If the server returns `404` for the history id (Gmail keeps ~7 days),
 *     we fall back to `gmail.users.messages.list?labelIds=INBOX` and persist
 *     the new historyId from the next `getProfile` call.
 */
class GmailChannelAdapter implements ChannelAdapter {
  readonly providerKey = 'gmail'
  readonly channelType = 'email'
  readonly capabilities = gmailCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    let native: ChannelNativeContent
    try {
      native = await convertOutboundForGmail({
        body: input.content.html ?? input.content.text ?? '',
        bodyFormat: input.content.bodyFormat ?? (input.content.html ? 'html' : 'text'),
        attachments: input.content.attachments,
        channelMetadata: input.metadata,
        fromAddress: userCredentials.email ?? 'me',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Outbound conversion failed'
      return { externalMessageId: '', status: 'failed', error: message }
    }

    const nativeMeta = native.metadata as unknown as GmailEmailNativeMetadata
    const rawBase64Url = encodeBase64Url(nativeMeta.rawMessage)

    try {
      const response = await getGmailApiClient().sendRawMessage(
        { accessToken: userCredentials.accessToken },
        { rawBase64Url, threadId: nativeMeta.threadId },
      )
      return {
        externalMessageId: nativeMeta.messageId ?? response.id,
        conversationId: response.threadId,
        status: 'sent',
        metadata: { gmailMessageId: response.id, gmailThreadId: response.threadId, labelIds: response.labelIds ?? [] },
      }
    } catch (error) {
      if (error instanceof GmailApiError && error.status === 401) {
        // `requires_reauth` is a protocol sentinel the hub keys on (see
        // communication_channels error-classification.isReauthError), not a
        // user/log message — do NOT prefix or translate it.
        return { externalMessageId: '', status: 'failed', error: 'requires_reauth' }
      }
      const message = error instanceof Error ? error.message : 'Gmail send failed'
      return { externalMessageId: '', status: 'failed', error: message }
    }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    // Gmail Pub/Sub push (Spec C) is handled by the dedicated `/webhooks/gmail`
    // route + `applyPushNotification`, not this generic hub-webhook hook, so this
    // returns an unhandled event for the generic route to ack 2xx.
    return { raw: {}, eventType: 'other', metadata: { reason: 'gmail-uses-polling-not-push' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    // Gmail exposes no per-message delivery-status API, so we return a
    // best-effort `'sent'` placeholder (a later bounce is not reflected here).
    // Mirrors the IMAP adapter's documented behavior.
    return { status: 'sent' }
  }

  async convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
    return convertOutboundForGmail({ ...input, fromAddress: 'me' })
  }

  async normalizeInbound(raw: InboundMessage): Promise<NormalizedInboundMessage> {
    const payload = raw.raw as {
      rawBase64Url?: unknown
      rawBody?: unknown
      gmailMessageId?: unknown
      gmailThreadId?: unknown
      labelIds?: unknown
      accountIdentifier?: unknown
    }
    const rawMessage = pickRawMimeBuffer(payload)
    const gmailMessageId = typeof payload.gmailMessageId === 'string' ? payload.gmailMessageId : 'unknown'
    const gmailThreadId = typeof payload.gmailThreadId === 'string' ? payload.gmailThreadId : gmailMessageId
    const labelIds = Array.isArray(payload.labelIds) ? (payload.labelIds.filter((v) => typeof v === 'string') as string[]) : []
    const accountIdentifier = typeof payload.accountIdentifier === 'string' ? payload.accountIdentifier : 'unknown@gmail'
    return normalizeInboundGmailMessage({
      rawMessage,
      gmailMessageId,
      gmailThreadId,
      gmailLabelIds: labelIds,
      accountIdentifier,
    })
  }

  async buildOAuthAuthorizeUrl(input: BuildOAuthAuthorizeUrlInput): Promise<BuildOAuthAuthorizeUrlResult> {
    const client = parseClientCredentialsOrThrow(input.credentials)
    const scopes = parseScopes(client.scopes)
    const url = getGoogleOAuthClient().buildAuthorizeUrl({
      clientId: client.clientId,
      redirectUri: input.redirectUri,
      state: input.state,
      scopes,
      loginHint: input.loginHint,
    })
    return { authorizeUrl: url, extra: { scopes } }
  }

  async exchangeOAuthCode(input: ExchangeOAuthCodeInput): Promise<ExchangeOAuthCodeResult> {
    const client = parseClientCredentialsOrThrow(input.credentials)
    const token = await getGoogleOAuthClient().exchangeCode({
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      redirectUri: input.redirectUri,
      code: input.code,
    })
    let email: string | undefined
    let displayName: string | undefined
    try {
      const userInfo = await getGoogleOAuthClient().fetchUserInfo(token.access_token)
      email = userInfo.email
      displayName = userInfo.name ?? userInfo.email
    } catch {
      // Userinfo failure is non-fatal; fall back to the optional `id_token` parser later.
    }
    const expiresAt = tokenResponseToExpiresAt(token)
    const credentials: GmailUserCredentials = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: expiresAt?.toISOString(),
      scopes: token.scope ? token.scope.split(' ').filter(Boolean) : undefined,
      email,
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
      throw new Error('requires_reauth')
    }
    // Spec A: prefer the new `input.oauthClient` slot (resolved by the hub from
    // the `channel_gmail` integration's tenant-scoped client credentials). Fall
    // back to the deprecated `credentials._client` path for one minor release so
    // existing test fixtures keep working.
    const clientFromState = resolveGmailOAuthClient(input)
    const token = await getGoogleOAuthClient().refreshToken({
      clientId: clientFromState.clientId,
      clientSecret: clientFromState.clientSecret,
      refreshToken: current.refreshToken,
    })
    const expiresAt = tokenResponseToExpiresAt(token)
    const refreshed: GmailUserCredentials = {
      accessToken: token.access_token,
      // Google does NOT always return a new refresh token — keep the existing one.
      refreshToken: token.refresh_token ?? current.refreshToken,
      expiresAt: expiresAt?.toISOString(),
      scopes: token.scope ? token.scope.split(' ').filter(Boolean) : current.scopes,
      email: current.email,
    }
    return {
      credentials: refreshed as unknown as Record<string, unknown>,
      expiresAt,
    }
  }

  async fetchHistory(input: FetchHistoryInput): Promise<HistoryPage> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    const channelState = gmailChannelStateSchema.parse(input.channelState ?? {})
    const auth = { accessToken: userCredentials.accessToken }
    const api = getGmailApiClient()
    const limit = input.limit ?? 50

    // L3 first-page retry: a prior fallback scan hard-failed on its FIRST page and
    // pinned only the history snapshot (no page token). Re-enter the fallback scan
    // from the first INBOX page so unprocessed messages are retried, not skipped by
    // the bootstrap path below.
    if (channelState.pendingMessagesHistoryIdSnapshot && !channelState.pendingMessagesPageToken) {
      return await this.startMessagesListFallback(
        api,
        auth,
        userCredentials.email ?? 'me',
        channelState.pendingMessagesHistoryIdSnapshot,
        limit,
      )
    }

    // Bootstrap path: no historyId yet → just persist current historyId and skip fetch.
    if (!channelState.historyId && !channelState.pendingMessagesPageToken) {
      const profile = await api.getProfile(auth)
      const nextState: GmailChannelState = {
        historyId: profile.historyId,
        lastSyncedAt: new Date().toISOString(),
      }
      return {
        messages: [],
        nextCursor: encodeCursor(nextState),
        hasMore: false,
      }
    }

    // Mid-drain fallback (404 path): we previously fell back to messages.list
    // for an expired historyId and still have pages to drain. Resume from the
    // stored pageToken without re-issuing the history.list call.
    if (channelState.pendingMessagesPageToken) {
      return await this.continueMessagesListDrain(
        api,
        auth,
        userCredentials.email ?? 'me',
        channelState,
        limit,
      )
    }

    // Incremental path: history.list since stored historyId, walking
    // nextPageToken until either (a) all pages drained, or (b) we've collected
    // `limit` messages.
    // CRITICAL: terminal historyId is ONLY advanced after full drain. While a
    // pending pageToken exists in channelState, the original startHistoryId is
    // retained so the next tick re-enters the same history window.
    let messages: NormalizedInboundMessage[] = []
    try {
      return await this.continueHistoryListDrain(
        api,
        auth,
        userCredentials.email ?? 'me',
        channelState,
        String(channelState.historyId),
        limit,
      )
    } catch (error) {
      if (error instanceof GmailApiError && error.status === 404) {
        // Gmail history expired (~7-day retention). Fall back to a paged inbox
        // scan via messages.list. Snapshot the post-fallback historyId now so
        // we can advance it once the messages.list drain completes.
        const profile = await api.getProfile(auth)
        return await this.startMessagesListFallback(
          api,
          auth,
          userCredentials.email ?? 'me',
          profile.historyId,
          limit,
        )
      }
      throw error
    }
  }

  /**
   * Spec C § Phase C2 — Register Gmail Pub/Sub watch.
   *
   * Calls `gmail.users.watch` with the operator-configured Pub/Sub topic.
   * Returns `historyId` (cursor for subsequent `history.list` calls) and
   * `expiration` (ms since epoch — Gmail caps at ~7 days). Persists both
   * onto `CommunicationChannel.channelState` via the hub's
   * `push.register` command.
   */
  async registerPush(input: RegisterPushInput): Promise<PushRegistration> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    const auth = { accessToken: userCredentials.accessToken }
    const api = getGmailApiClient()
    const topicName = (input.providerConfig?.pubsubTopic as string | undefined) ?? ''
    if (!topicName) {
      return {
        providerKey: this.providerKey,
        status: 'failed',
        channelStatePatch: {
          pushStatus: 'failed',
          lastPushError: {
            code: 'missing_topic',
            message: 'Pub/Sub topic not configured',
            at: new Date().toISOString(),
          },
        },
        error: {
          code: 'missing_topic',
          message: 'OM_GMAIL_PUBSUB_TOPIC not configured for this tenant',
        },
      }
    }
    try {
      const result = await api.watchInbox(auth, { topicName, labelIds: ['INBOX'] })
      const expirationMs = Number(result.expiration)
      return {
        providerKey: this.providerKey,
        status: 'active',
        channelStatePatch: {
          historyId: result.historyId,
          watchExpirationMs: Number.isFinite(expirationMs) ? expirationMs : Date.now() + 6 * 24 * 3600 * 1000,
          pubsubTopic: topicName,
          pushStatus: 'active',
          lastPushError: null,
        },
        recommendedPollIntervalSeconds: 1800,
      }
    } catch (error) {
      const status = error instanceof GmailApiError ? error.status : 0
      const detail = error instanceof Error ? error.message : 'watch failed'
      return {
        providerKey: this.providerKey,
        status: 'failed',
        channelStatePatch: {
          pushStatus: 'failed',
          lastPushError: {
            code: `gmail_watch_${status || 'error'}`,
            message: detail.slice(0, 500),
            at: new Date().toISOString(),
          },
        },
        error: { code: `gmail_watch_${status || 'error'}`, message: detail },
      }
    }
  }

  /**
   * Spec C § Phase C2 — Tear down Gmail watch via `gmail.users.stop`.
   * Idempotent: a 404 (no active watch) is swallowed.
   */
  async unregisterPush(input: UnregisterPushInput): Promise<void> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    const auth = { accessToken: userCredentials.accessToken }
    const api = getGmailApiClient()
    try {
      await api.stopWatch(auth)
    } catch (error) {
      if (error instanceof GmailApiError && error.status === 404) return
      throw error
    }
  }

  /**
   * Spec C § Phase C2 — Convert a verified Pub/Sub notification into a
   * `HistoryPage`. The notification body itself is just `{ emailAddress,
   * historyId }`; the actual messages come from `history.list` against
   * `channelState.historyId`. We delegate to `fetchHistory` so the
   * pagination / 404-fallback logic stays in one place.
   */
  async applyPushNotification(input: ApplyPushNotificationInput): Promise<HistoryPage> {
    // The notification's `historyId` is informational — Gmail guarantees
    // it is `>= channelState.historyId`, but a multi-event batch may
    // advance further than what `history.list` returns in a single page.
    // Treat the call as "drain whatever is new since the stored cursor".
    // If `channelState.historyId` is absent (a push arrived before the cursor
    // was seeded), `fetchHistory` bootstraps — persists the current historyId
    // and returns zero messages — so this notification's delta is picked up on
    // the next call. In practice `registerPush` seeds the cursor before any
    // push flows, so this edge is not hit in the normal lifecycle.
    return this.fetchHistory({
      conversationId: 'INBOX',
      credentials: input.credentials,
      channelState: input.channelState,
      scope: input.scope,
      // Push notifications are bursty (1/s max per Gmail user); use a
      // smaller per-call limit so the worker drains quickly between
      // notifications without holding the API quota.
      limit: 50,
    } as FetchHistoryInput)
  }

  private async continueHistoryListDrain(
    api: ReturnType<typeof getGmailApiClient>,
    auth: { accessToken: string },
    accountIdentifier: string,
    channelState: GmailChannelState,
    startHistoryId: string,
    limit: number,
  ): Promise<HistoryPage> {
    const collected: Array<{ id: string; threadId: string; labelIds?: string[] }> = []
    const seen = new Set<string>()
    let pageToken: string | undefined = channelState.pendingHistoryPageToken
    let lastResponseHistoryId: string | undefined
    let drained = false

    // Fully consume each page before deciding to stop: `pageToken` must only ever
    // advance past refs we have actually collected, otherwise a page carrying more
    // than `limit` new refs would silently drop the overflow. `collected` may
    // therefore exceed `limit` by up to one page — bounded and intentional.
    while (true) {
      const history = await api.listHistory(auth, {
        startHistoryId,
        pageToken,
      })
      lastResponseHistoryId = history.historyId ?? lastResponseHistoryId
      for (const ref of collectMessageRefs(history.history ?? [])) {
        if (seen.has(ref.id)) continue
        seen.add(ref.id)
        collected.push(ref)
      }
      if (!history.nextPageToken) {
        drained = true
        break
      }
      pageToken = history.nextPageToken
      if (collected.length >= limit) break
    }

    const { messages, hardFailed } = await this.fetchAndNormalize(api, auth, collected, accountIdentifier)
    const nextState: GmailChannelState = {
      lastSyncedAt: new Date().toISOString(),
    }
    if (hardFailed) {
      // L3: a message failed transiently. Restart the window from startHistoryId
      // on the next tick (drop any page token) so every page — including the one
      // carrying the failed message — is re-read; already-ingested messages dedup
      // at the hub. Do NOT advance the terminal historyId or pin a forward token,
      // which would skip the failed message's page.
      nextState.historyId = startHistoryId
    } else if (drained) {
      // All pages drained — advance the terminal historyId.
      nextState.historyId = lastResponseHistoryId ?? startHistoryId
    } else {
      // Mid-drain — keep the prior startHistoryId pinned + remember the next
      // unconsumed pageToken so the following tick resumes without re-walking.
      nextState.historyId = startHistoryId
      nextState.pendingHistoryPageToken = pageToken
    }
    return {
      messages,
      nextCursor: encodeCursor(nextState),
      // Re-enqueue immediately when a transient failure left work behind.
      hasMore: hardFailed || !drained,
    }
  }

  private async startMessagesListFallback(
    api: ReturnType<typeof getGmailApiClient>,
    auth: { accessToken: string },
    accountIdentifier: string,
    historyIdSnapshot: string,
    limit: number,
  ): Promise<HistoryPage> {
    const list = await api.listMessages(auth, {
      labelIds: ['INBOX'],
      maxResults: limit,
    })
    const refs = (list.messages ?? []).map((m) => ({
      id: m.id,
      threadId: m.threadId,
      labelIds: ['INBOX'],
    }))
    const { messages, hardFailed } = await this.fetchAndNormalize(api, auth, refs, accountIdentifier)
    const drained = !list.nextPageToken
    const nextState: GmailChannelState = {
      lastSyncedAt: new Date().toISOString(),
    }
    if (hardFailed) {
      // L3: this is the FIRST fallback page (no prior page token), so there is
      // nothing to pin. Deliberately leave `historyId` unset so the cursor does
      // NOT advance past the unprocessed messages — the next tick re-enters the
      // same fallback scan and retries them.
      nextState.pendingMessagesHistoryIdSnapshot = historyIdSnapshot
    } else if (drained) {
      nextState.historyId = historyIdSnapshot
    } else {
      nextState.pendingMessagesPageToken = list.nextPageToken
      nextState.pendingMessagesHistoryIdSnapshot = historyIdSnapshot
    }
    return {
      messages,
      nextCursor: encodeCursor(nextState),
      hasMore: hardFailed || !drained,
    }
  }

  private async continueMessagesListDrain(
    api: ReturnType<typeof getGmailApiClient>,
    auth: { accessToken: string },
    accountIdentifier: string,
    channelState: GmailChannelState,
    limit: number,
  ): Promise<HistoryPage> {
    const list = await api.listMessages(auth, {
      labelIds: ['INBOX'],
      maxResults: limit,
      pageToken: channelState.pendingMessagesPageToken,
    })
    const refs = (list.messages ?? []).map((m) => ({
      id: m.id,
      threadId: m.threadId,
      labelIds: ['INBOX'],
    }))
    const { messages, hardFailed } = await this.fetchAndNormalize(api, auth, refs, accountIdentifier)
    const drained = !list.nextPageToken
    const nextState: GmailChannelState = {
      lastSyncedAt: new Date().toISOString(),
    }
    if (hardFailed) {
      // L3: re-pin the SAME page token (not list.nextPageToken) so the next
      // tick re-fetches this page and retries the unprocessed messages.
      nextState.pendingMessagesPageToken = channelState.pendingMessagesPageToken
      nextState.pendingMessagesHistoryIdSnapshot = channelState.pendingMessagesHistoryIdSnapshot
    } else if (drained) {
      nextState.historyId = channelState.pendingMessagesHistoryIdSnapshot ?? channelState.historyId
    } else {
      nextState.pendingMessagesPageToken = list.nextPageToken
      nextState.pendingMessagesHistoryIdSnapshot = channelState.pendingMessagesHistoryIdSnapshot
    }
    return {
      messages,
      nextCursor: encodeCursor(nextState),
      hasMore: hardFailed || !drained,
    }
  }

  async deleteMessage(input: DeleteChannelMessageInput): Promise<void> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    const api = getGmailApiClient()
    // Gmail's "delete" capability is delivered as Trash to match the user's
    // mental model and avoid permanent loss on accidental clicks. The user can
    // restore from Trash in the Gmail web UI within 30 days.
    await api.trashMessage({ accessToken: userCredentials.accessToken }, input.externalMessageId)
  }

  async resolveContact(input: ResolveContactInput): Promise<ContactHint | null> {
    return emailResolveContact(input)
  }

  /**
   * Fetch + normalize each collected message ref.
   *
   * L3 fix: a non-404/410 error on `getMessageRaw` (e.g. a transient 500/403)
   * used to re-throw and abort the whole tick, discarding messages that had
   * already normalized in the same page. Worse, because the cursor could be
   * advanced from a different source (a push notification carrying a higher
   * historyId), the transiently-failed messages could be skipped permanently.
   *
   * We now treat a hard failure as a stop point: keep the messages normalized
   * BEFORE the failure and signal `hardFailed: true` so the caller pins the
   * persisted `historyId` (does NOT advance past the failure) and re-fetches on
   * the next tick. 404/410 stay skipped (the message is genuinely gone).
   */
  private async fetchAndNormalize(
    api: ReturnType<typeof getGmailApiClient>,
    auth: { accessToken: string },
    refs: Array<{ id: string; threadId: string; labelIds?: string[] }>,
    accountIdentifier: string,
  ): Promise<{ messages: NormalizedInboundMessage[]; hardFailed: boolean }> {
    const out: NormalizedInboundMessage[] = []
    for (const ref of refs) {
      let raw: GmailGetMessageRawResponse
      try {
        raw = await api.getMessageRaw(auth, ref.id)
      } catch (error) {
        // 404/410: the message is gone — skip it and keep draining.
        if (error instanceof GmailApiError && (error.status === 404 || error.status === 410)) continue
        // Any other failure is potentially transient. Stop here without
        // advancing past the unprocessed messages so the next tick retries them.
        return { messages: out, hardFailed: true }
      }
      const rawBuffer = decodeBase64Url(raw.raw)
      const fallbackDate = raw.internalDate ? new Date(Number(raw.internalDate)) : undefined
      const normalized = await normalizeInboundGmailMessage({
        rawMessage: rawBuffer,
        gmailMessageId: raw.id,
        gmailThreadId: raw.threadId,
        gmailLabelIds: raw.labelIds ?? ref.labelIds ?? [],
        accountIdentifier,
        fallbackDate,
      })
      out.push(normalized)
    }
    return { messages: out, hardFailed: false }
  }
}

function collectMessageRefs(
  history: Array<{
    messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds?: string[] } }>
  }>,
): Array<{ id: string; threadId: string; labelIds?: string[] }> {
  const seen = new Set<string>()
  const refs: Array<{ id: string; threadId: string; labelIds?: string[] }> = []
  for (const entry of history) {
    for (const added of entry.messagesAdded ?? []) {
      if (seen.has(added.message.id)) continue
      seen.add(added.message.id)
      refs.push({ id: added.message.id, threadId: added.message.threadId, labelIds: added.message.labelIds })
    }
  }
  return refs
}

function parseUserCredentialsOrThrow(value: unknown): GmailUserCredentials {
  const parsed = gmailUserCredentialsSchema.safeParse(value)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`Invalid Gmail credentials: ${first?.message ?? 'unknown validation error'}`)
  }
  return parsed.data
}

function parseClientCredentialsOrThrow(value: unknown): GmailClientCredentials {
  const parsed = gmailClientCredentialsSchema.safeParse(value)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`Invalid Gmail OAuth client credentials: ${first?.message ?? 'unknown validation error'}`)
  }
  return parsed.data
}

let warnedLegacyClientPath = false

/**
 * Resolve the OAuth client config for a Gmail refresh, preferring the new
 * `RefreshCredentialsInput.oauthClient` field (Spec A,
 * .ai/specs/implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md).
 *
 * Falls back to the deprecated `credentials._client` read path for one
 * minor release so existing tests keep working. The legacy path emits a
 * one-time deprecation warning per process so production logs stay quiet.
 */
function resolveGmailOAuthClient(input: RefreshCredentialsInput): GmailClientCredentials {
  if (input.oauthClient) {
    const client = input.oauthClient
    if (!client.clientId) {
      throw new Error('[internal] Invalid Gmail OAuth client credentials: OAuth Client ID required')
    }
    if (!client.clientSecret) {
      throw new Error('[internal] Invalid Gmail OAuth client credentials: clientSecret required')
    }
    return {
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      // `GmailClientCredentials.scopes` is the wire format the legacy
      // `credentials._client` blob carried — comma/space-separated string.
      // Spec A's `OAuthClientConfig.scopes` is the canonical `string[]`.
      // `parseScopes` accepts either separator, so join with a single space.
      ...(client.scopes !== undefined ? { scopes: client.scopes.join(' ') } : {}),
    }
  }
  // Legacy path — DEPRECATED. Remove in the next minor release.
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

function pickRawMimeBuffer(payload: { rawBase64Url?: unknown; rawBody?: unknown }): Buffer {
  if (typeof payload.rawBase64Url === 'string') return decodeBase64Url(payload.rawBase64Url)
  const value = payload.rawBody
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'utf-8')
  throw new Error('[internal] Gmail normalizeInbound requires `raw.rawBase64Url` or `raw.rawBody`')
}

let cachedAdapter: GmailChannelAdapter | null = null

export function getGmailChannelAdapter(): GmailChannelAdapter {
  if (!cachedAdapter) cachedAdapter = new GmailChannelAdapter()
  return cachedAdapter
}

export { GmailChannelAdapter }
