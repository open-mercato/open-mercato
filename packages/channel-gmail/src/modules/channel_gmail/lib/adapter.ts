import type {
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
  RefreshCredentialsInput,
  RefreshedCredentials,
  ResolveContactInput,
  ContactHint,
  SendMessageInput,
  SendMessageResult,
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
  type GmailMessagesListResponse,
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
        return { externalMessageId: '', status: 'failed', error: 'requires_reauth' }
      }
      const message = error instanceof Error ? error.message : 'Gmail send failed'
      return { externalMessageId: '', status: 'failed', error: message }
    }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    // Gmail Pub/Sub push is deferred to v2. The route still exists for forward
    // compatibility but we return an unhandled event so the hub responds 2xx.
    return { raw: {}, eventType: 'other', metadata: { reason: 'gmail-uses-polling-not-push' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
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
    const clientFromState = parseClientCredentialsOrThrow(
      (input.credentials as unknown as { _client?: unknown })._client ?? input.credentials,
    )
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
    const channelState = gmailChannelStateSchema.parse(
      ((input as unknown) as { channelState?: unknown }).channelState ?? {},
    )
    const auth = { accessToken: userCredentials.accessToken }
    const api = getGmailApiClient()
    const limit = input.limit ?? 50

    // Bootstrap path: no historyId yet → just persist current historyId and skip fetch.
    if (!channelState.historyId && !channelState.pendingMessagesPageToken) {
      const profile = await api.getProfile(auth)
      const nextState: GmailChannelState = {
        historyId: profile.historyId,
        lastSyncedAt: new Date().toISOString(),
      }
      return {
        messages: [],
        nextCursor: Buffer.from(JSON.stringify(nextState)).toString('base64'),
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

    while (collected.length < limit) {
      const history = await api.listHistory(auth, {
        startHistoryId,
        pageToken,
      })
      lastResponseHistoryId = history.historyId ?? lastResponseHistoryId
      for (const ref of collectMessageRefs(history.history ?? [])) {
        if (seen.has(ref.id)) continue
        seen.add(ref.id)
        collected.push(ref)
        if (collected.length >= limit) break
      }
      if (!history.nextPageToken) {
        drained = true
        break
      }
      pageToken = history.nextPageToken
    }

    const messages = await this.fetchAndNormalize(api, auth, collected, accountIdentifier)
    const nextState: GmailChannelState = {
      lastSyncedAt: new Date().toISOString(),
    }
    if (drained) {
      // All pages drained — advance the terminal historyId.
      nextState.historyId = lastResponseHistoryId ?? startHistoryId
    } else {
      // Mid-drain — keep the prior startHistoryId pinned + remember pageToken.
      nextState.historyId = startHistoryId
      nextState.pendingHistoryPageToken = pageToken
      nextState.pendingHistoryStartId = startHistoryId
    }
    return {
      messages,
      nextCursor: Buffer.from(JSON.stringify(nextState)).toString('base64'),
      hasMore: !drained,
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
    const messages = await this.fetchAndNormalize(api, auth, refs, accountIdentifier)
    const drained = !list.nextPageToken
    const nextState: GmailChannelState = {
      lastSyncedAt: new Date().toISOString(),
    }
    if (drained) {
      nextState.historyId = historyIdSnapshot
    } else {
      nextState.pendingMessagesPageToken = list.nextPageToken
      nextState.pendingMessagesHistoryIdSnapshot = historyIdSnapshot
    }
    return {
      messages,
      nextCursor: Buffer.from(JSON.stringify(nextState)).toString('base64'),
      hasMore: !drained,
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
    const messages = await this.fetchAndNormalize(api, auth, refs, accountIdentifier)
    const drained = !list.nextPageToken
    const nextState: GmailChannelState = {
      lastSyncedAt: new Date().toISOString(),
    }
    if (drained) {
      nextState.historyId = channelState.pendingMessagesHistoryIdSnapshot ?? channelState.historyId
    } else {
      nextState.pendingMessagesPageToken = list.nextPageToken
      nextState.pendingMessagesHistoryIdSnapshot = channelState.pendingMessagesHistoryIdSnapshot
    }
    return {
      messages,
      nextCursor: Buffer.from(JSON.stringify(nextState)).toString('base64'),
      hasMore: !drained,
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
    if (!input.senderIdentifier) return null
    if (input.senderIdentifier.includes('@')) {
      return {
        email: input.senderIdentifier,
        displayName: input.senderDisplayName,
      }
    }
    return null
  }

  private async fetchAndNormalize(
    api: ReturnType<typeof getGmailApiClient>,
    auth: { accessToken: string },
    refs: Array<{ id: string; threadId: string; labelIds?: string[] }>,
    accountIdentifier: string,
  ): Promise<NormalizedInboundMessage[]> {
    const out: NormalizedInboundMessage[] = []
    for (const ref of refs) {
      let raw: GmailGetMessageRawResponse
      try {
        raw = await api.getMessageRaw(auth, ref.id)
      } catch (error) {
        // Skip individual fetch failures rather than aborting the whole batch.
        if (error instanceof GmailApiError && (error.status === 404 || error.status === 410)) continue
        throw error
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
    return out
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

function pickRawMimeBuffer(payload: { rawBase64Url?: unknown; rawBody?: unknown }): Buffer {
  if (typeof payload.rawBase64Url === 'string') return decodeBase64Url(payload.rawBase64Url)
  const value = payload.rawBody
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') return Buffer.from(value, 'utf-8')
  throw new Error('Gmail normalizeInbound requires `raw.rawBase64Url` or `raw.rawBody`')
}

let cachedAdapter: GmailChannelAdapter | null = null

export function getGmailChannelAdapter(): GmailChannelAdapter {
  if (!cachedAdapter) cachedAdapter = new GmailChannelAdapter()
  return cachedAdapter
}

export { GmailChannelAdapter }
