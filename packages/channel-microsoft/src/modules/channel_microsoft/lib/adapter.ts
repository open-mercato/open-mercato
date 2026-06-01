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
import { microsoftCapabilities } from './capabilities'
import {
  microsoftChannelStateSchema,
  microsoftClientCredentialsSchema,
  microsoftUserCredentialsSchema,
  parseScopes,
  type MicrosoftChannelState,
  type MicrosoftClientCredentials,
  type MicrosoftUserCredentials,
} from './credentials'
import {
  getGraphApiClient,
  GraphApiError,
  type GraphMessage,
} from './graph-client'
import {
  decodeIdTokenClaims,
  generatePkcePair,
  getMicrosoftOAuthClient,
  MICROSOFT_GRAPH_BASE,
  tokenResponseToExpiresAt,
} from './oauth'
import {
  convertOutboundForMicrosoft,
  type MicrosoftEmailNativeMetadata,
} from './convert-outbound'
import { normalizeInboundMicrosoftMessage } from './normalize-inbound'
import { emailResolveContact } from '@open-mercato/core/modules/communication_channels/lib/email-contact'
import { encodeCursor } from '@open-mercato/core/modules/communication_channels/lib/email-mime'

const GRAPH_TRUSTED_ORIGIN = (() => {
  try {
    return new URL(MICROSOFT_GRAPH_BASE).origin
  } catch {
    return 'https://graph.microsoft.com'
  }
})()

/**
 * Delta/next links are fetched with the user's bearer token, so only follow
 * links on the trusted Graph origin. A poisoned `channelState` link is dropped
 * (the caller falls back to a fresh delta) to prevent token-bearing SSRF.
 */
function isTrustedGraphLink(url: string): boolean {
  try {
    return new URL(url).origin === GRAPH_TRUSTED_ORIGIN
  } catch {
    return false
  }
}

/**
 * Microsoft 365 / Outlook `ChannelAdapter`. OAuth2 + PKCE; polling via Graph delta query.
 *
 * Credential shape on `CommunicationChannel.credentials`:
 *   - Per-user (this blob): `{ accessToken, refreshToken?, expiresAt?, scopes?, email?, oid? }`
 *   - Tenant OAuth client config on `IntegrationCredentials.credentials` (provider `microsoft`):
 *     `{ clientId, tenantId?, clientSecret?, scopes? }`. The hub looks this up by
 *     `(tenantId, providerKey='microsoft')` and passes it through.
 *
 * Sync model:
 *   - First poll: `GET /me/mailFolders/inbox/messages/delta` (no link). Persist the
 *     returned `@odata.deltaLink`. We do NOT back-fill the entire inbox — Microsoft
 *     Graph's delta endpoint returns the recent slice + a deltaLink for go-forward
 *     incremental sync, matching Gmail's bootstrap behavior.
 *   - Subsequent polls: re-call the persisted deltaLink verbatim.
 *   - If Graph returns `410 Gone` (deltaLink invalidated), we drop the cursor and
 *     do a fresh delta call.
 */
class MicrosoftChannelAdapter implements ChannelAdapter {
  readonly providerKey = 'microsoft'
  readonly channelType = 'email'
  readonly capabilities = microsoftCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    let native: ChannelNativeContent
    try {
      native = await convertOutboundForMicrosoft({
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

    const nativeMeta = native.metadata as unknown as MicrosoftEmailNativeMetadata

    try {
      await getGraphApiClient().sendMail({ accessToken: userCredentials.accessToken }, nativeMeta.sendMailBody)
      // Graph's /me/sendMail returns 202 Accepted with no body. The hub's MessageId
      // becomes the canonical id; downstream consumers can look up the actual Graph
      // message id later via the next inbox poll if they need to.
      return {
        externalMessageId: nativeMeta.messageId ?? '',
        conversationId: nativeMeta.conversationId,
        status: 'sent',
        metadata: { provider: 'microsoft' },
      }
    } catch (error) {
      if (error instanceof GraphApiError && (error.status === 401 || error.status === 403)) {
        return { externalMessageId: '', status: 'failed', error: 'requires_reauth' }
      }
      const message = error instanceof Error ? error.message : 'Microsoft Graph sendMail failed'
      return { externalMessageId: '', status: 'failed', error: message }
    }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    // Graph change-notification push (Spec C) is handled by the dedicated
    // `/webhooks/microsoft/[subscriptionId]` route + `applyPushNotification`, not
    // this generic hub-webhook hook, so this returns an unhandled event for the
    // generic route to ack 2xx.
    return { raw: {}, eventType: 'other', metadata: { reason: 'microsoft-uses-polling-not-push' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    return { status: 'sent' }
  }

  async convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
    return convertOutboundForMicrosoft({ ...input, fromAddress: 'me' })
  }

  async normalizeInbound(raw: InboundMessage): Promise<NormalizedInboundMessage> {
    const payload = raw.raw as { message?: unknown; accountIdentifier?: unknown }
    if (!payload?.message || typeof payload.message !== 'object') {
      throw new Error('Microsoft normalizeInbound requires raw.message (Graph Message resource)')
    }
    return normalizeInboundMicrosoftMessage({
      message: payload.message as GraphMessage,
      accountIdentifier: typeof payload.accountIdentifier === 'string' ? payload.accountIdentifier : 'unknown@outlook',
    })
  }

  async buildOAuthAuthorizeUrl(input: BuildOAuthAuthorizeUrlInput): Promise<BuildOAuthAuthorizeUrlResult> {
    const client = parseClientCredentialsOrThrow(input.credentials)
    const scopes = parseScopes(client.scopes)
    const { codeVerifier, codeChallenge } = generatePkcePair()
    const authorizeUrl = getMicrosoftOAuthClient().buildAuthorizeUrl({
      clientId: client.clientId,
      tenantId: client.tenantId,
      redirectUri: input.redirectUri,
      state: input.state,
      scopes,
      loginHint: input.loginHint,
      codeChallenge,
    })
    return {
      authorizeUrl,
      // Persist the verifier + tenantId in the hub's state cookie so we can hand
      // them back at exchange time.
      extra: { codeVerifier, scopes, tenantId: client.tenantId },
    }
  }

  async exchangeOAuthCode(input: ExchangeOAuthCodeInput): Promise<ExchangeOAuthCodeResult> {
    const client = parseClientCredentialsOrThrow(input.credentials)
    const stateExtra = (input.stateExtra ?? {}) as { codeVerifier?: unknown; tenantId?: unknown }
    const codeVerifier = typeof stateExtra.codeVerifier === 'string' ? stateExtra.codeVerifier : undefined
    if (!codeVerifier) {
      throw new Error('Microsoft OAuth exchange requires the PKCE codeVerifier from state')
    }
    const tenantId = typeof stateExtra.tenantId === 'string' ? stateExtra.tenantId : client.tenantId
    const token = await getMicrosoftOAuthClient().exchangeCode({
      clientId: client.clientId,
      tenantId,
      clientSecret: client.clientSecret,
      redirectUri: input.redirectUri,
      code: input.code,
      codeVerifier,
    })
    // SECURITY: these id_token claims are decoded WITHOUT signature verification
    // and are used ONLY for display metadata (email / oid / name) — never for
    // authorization. Authorization always rides the access token validated by Graph.
    const claims = decodeIdTokenClaims(token.id_token)
    const email = claims.email
    const expiresAt = tokenResponseToExpiresAt(token)
    const credentials: MicrosoftUserCredentials = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: expiresAt?.toISOString(),
      scopes: token.scope ? token.scope.split(' ').filter(Boolean) : undefined,
      email,
      oid: claims.oid,
    }
    return {
      credentials: credentials as unknown as Record<string, unknown>,
      externalIdentifier: email,
      displayName: claims.name ?? email,
      expiresAt,
    }
  }

  async refreshCredentials(input: RefreshCredentialsInput): Promise<RefreshedCredentials> {
    const current = parseUserCredentialsOrThrow(input.credentials)
    if (!current.refreshToken) {
      throw new Error('requires_reauth')
    }
    // Spec A: prefer the new `input.oauthClient` slot (resolved by the hub
    // from `oauth_microsoft` integration credentials). Fall back to the
    // deprecated `credentials._client` path for one minor release so
    // existing test fixtures keep working.
    const clientFromState = resolveMicrosoftOAuthClient(input)
    const token = await getMicrosoftOAuthClient().refreshToken({
      clientId: clientFromState.clientId,
      tenantId: clientFromState.tenantId,
      clientSecret: clientFromState.clientSecret,
      refreshToken: current.refreshToken,
    })
    const expiresAt = tokenResponseToExpiresAt(token)
    const refreshed: MicrosoftUserCredentials = {
      accessToken: token.access_token,
      // Microsoft rotates the refresh token on each refresh by default — adopt the new one.
      refreshToken: token.refresh_token ?? current.refreshToken,
      expiresAt: expiresAt?.toISOString(),
      scopes: token.scope ? token.scope.split(' ').filter(Boolean) : current.scopes,
      email: current.email,
      oid: current.oid,
    }
    return {
      credentials: refreshed as unknown as Record<string, unknown>,
      expiresAt,
    }
  }

  async fetchHistory(input: FetchHistoryInput): Promise<HistoryPage> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    const channelState = microsoftChannelStateSchema.parse(input.channelState ?? {})
    const auth = { accessToken: userCredentials.accessToken }
    const api = getGraphApiClient()
    const limit = input.limit ?? 50
    const accountId = userCredentials.email ?? 'me'

    // Resolve the starting URL for this tick.
    //   1. Mid-drain resumption (`pendingNextLink`) — keep going where we
    //      stopped last tick; do NOT advance `deltaLink` until we reach a
    //      response that carries `@odata.deltaLink` (full drain).
    //   2. Otherwise fall through to the standard delta starting point
    //      (resumed via stored `deltaLink` or fresh inbox-delta on first poll).
    let firstLink: string | undefined = channelState.pendingNextLink ?? channelState.deltaLink
    if (firstLink && !isTrustedGraphLink(firstLink)) {
      console.warn(
        `[channel-microsoft] ignoring untrusted delta link from channel state (expected origin ${GRAPH_TRUSTED_ORIGIN}); falling back to fresh delta`,
      )
      firstLink = undefined
    }

    const messages: NormalizedInboundMessage[] = []
    let nextLink: string | undefined
    let terminalDeltaLink: string | undefined
    let pageCount = 0
    const PAGE_HARD_CAP = 25 // safety stop in case Graph returns very small pages

    while (messages.length < limit && pageCount < PAGE_HARD_CAP) {
      let response
      try {
        response = await api.inboxDelta(auth, firstLink)
      } catch (error) {
        if (error instanceof GraphApiError && (error.status === 410 || error.status === 404)) {
          // Cursor invalidated. Drop both pendingNextLink and deltaLink and
          // re-init from a fresh delta call. Any messages collected so far stay
          // (idempotent on ingest).
          firstLink = undefined
          response = await api.inboxDelta(auth, undefined)
        } else {
          throw error
        }
      }
      pageCount += 1

      // Consume the FULL page before deciding to stop. Graph only lets us resume a
      // delta set via nextLink/deltaLink, never mid-page, so breaking at `limit`
      // here and then advancing the terminal deltaLink below would silently drop
      // this page's remaining messages. `messages` may exceed `limit` by one page.
      for (const m of response.value ?? []) {
        if (!m.from && !m.subject && !m.body) continue
        messages.push(await normalizeInboundMicrosoftMessage({ message: m, accountIdentifier: accountId }))
      }

      if (response['@odata.deltaLink']) {
        // Full drain complete — Graph emits @odata.deltaLink at the end of a
        // delta-page-set, signalling "no more changes to walk right now". We
        // can advance the terminal cursor.
        terminalDeltaLink = response['@odata.deltaLink']
        nextLink = undefined
        break
      }
      if (!response['@odata.nextLink']) {
        // No nextLink and no deltaLink — defensive. Keep the prior deltaLink
        // and treat as "no more pages this tick".
        nextLink = undefined
        break
      }
      // More pages — either continue walking immediately (if budget allows) or
      // bail with the next link recorded for the next tick.
      nextLink = response['@odata.nextLink']
      // Re-validate every continuation link before it is reused to issue another
      // bearer-token request. The initial link is checked above; a foreign
      // @odata.nextLink in a (MITM'd) response body must not redirect an
      // authenticated Graph call to an untrusted origin. Discard the poisoned
      // link and resume next tick from the last good deltaLink.
      if (nextLink && !isTrustedGraphLink(nextLink)) {
        nextLink = undefined
        break
      }
      if (messages.length >= limit) break
      firstLink = nextLink
    }

    const drained = !nextLink
    const nextState: MicrosoftChannelState = {
      // Preserve provider state this method does not own — notably the push
      // subscription fields (subscriptionId / subscriptionExpiresAt / pushStatus /
      // lastPushError). The poll worker persists this object as a FULL replace, so
      // omitting them here silently wipes the subscription and disables renewal.
      ...channelState,
      // Only advance terminal deltaLink when fully drained. While mid-drain,
      // pin the prior deltaLink so a recovery (e.g. operator clears
      // pendingNextLink) resumes from the right place.
      deltaLink: drained
        ? terminalDeltaLink ?? channelState.deltaLink
        : channelState.deltaLink,
      pendingNextLink: drained ? undefined : nextLink,
      lastSyncedAt: new Date().toISOString(),
    }
    return {
      messages,
      nextCursor: encodeCursor(nextState),
      hasMore: !drained,
    }
  }

  async deleteMessage(input: DeleteChannelMessageInput): Promise<void> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    await getGraphApiClient().deleteMessage(
      { accessToken: userCredentials.accessToken },
      input.externalMessageId,
    )
  }

  /**
   * Spec C § Phase C3 — Create a Microsoft Graph change-notification
   * subscription on the user's inbox. The hub generates a fresh per-channel
   * `clientState` (cryptographically-random 32-byte b64url nonce) before
   * invoking and persists it encrypted at rest in
   * `CommunicationChannel.client_state_encrypted`.
   *
   * Microsoft Graph performs a validation handshake at creation time: it
   * POSTs `?validationToken=…` to `notificationUrl`. Our webhook route
   * handles that synchronously (echoes the token verbatim). Without a
   * passing handshake `createSubscription` fails with 400/403.
   */
  async registerPush(input: RegisterPushInput): Promise<PushRegistration> {
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    const auth = { accessToken: userCredentials.accessToken }
    const api = getGraphApiClient()
    const clientState = (input.providerConfig?.clientState as string | undefined) ?? ''
    if (!clientState) {
      return {
        providerKey: this.providerKey,
        status: 'failed',
        channelStatePatch: {
          pushStatus: 'failed',
          lastPushError: {
            code: 'missing_client_state',
            message: 'Hub did not supply clientState',
            at: new Date().toISOString(),
          },
        },
        error: { code: 'missing_client_state', message: 'clientState required' },
      }
    }
    // Microsoft caps expirationDateTime at +4230 minutes (~70.5h) for
    // /me/messages plain notifications. Use +60h to leave headroom for
    // renewal scheduling (cron runs every 2 h with OM_PUSH_RENEWAL_MICROSOFT_LEAD_HOURS=4).
    const expiresAt = new Date(Date.now() + 60 * 60 * 60 * 1000)
    try {
      const subscription = await api.createSubscription(auth, {
        changeType: 'created',
        notificationUrl: input.notificationUrl,
        lifecycleNotificationUrl: input.lifecycleNotificationUrl,
        resource: "/me/mailFolders('inbox')/messages",
        expirationDateTime: expiresAt.toISOString(),
        clientState,
      })
      return {
        providerKey: this.providerKey,
        status: 'active',
        channelStatePatch: {
          subscriptionId: subscription.id,
          subscriptionExpiresAt: subscription.expirationDateTime,
          pushStatus: 'active',
          lastPushError: null,
        },
        recommendedPollIntervalSeconds: 1800,
      }
    } catch (error) {
      const status = error instanceof GraphApiError ? error.status : 0
      const detail = error instanceof Error ? error.message : 'create subscription failed'
      return {
        providerKey: this.providerKey,
        status: 'failed',
        channelStatePatch: {
          pushStatus: 'failed',
          lastPushError: {
            code: `graph_subscription_${status || 'error'}`,
            message: detail.slice(0, 500),
            at: new Date().toISOString(),
          },
        },
        error: { code: `graph_subscription_${status || 'error'}`, message: detail },
      }
    }
  }

  /**
   * Spec C § Phase C3 — Tear down the subscription. Idempotent on 404.
   * Reads `subscriptionId` from the persisted `channelState`.
   */
  async unregisterPush(input: UnregisterPushInput): Promise<void> {
    const subscriptionId = (input.channelState.subscriptionId as string | undefined) ?? ''
    if (!subscriptionId) return
    const userCredentials = parseUserCredentialsOrThrow(input.credentials)
    const api = getGraphApiClient()
    try {
      await api.deleteSubscription({ accessToken: userCredentials.accessToken }, subscriptionId)
    } catch (error) {
      if (error instanceof GraphApiError && error.status === 404) return
      throw error
    }
  }

  /**
   * Spec C § Phase C3 — Pull delta after a verified change notification.
   * The notification body is just a pointer; the actual messages are read
   * by walking `/me/mailFolders/inbox/messages/delta` from the stored
   * `deltaLink`. We delegate to `fetchHistory` so the 410-recovery and
   * pagination logic stays in one place.
   */
  async applyPushNotification(input: ApplyPushNotificationInput): Promise<HistoryPage> {
    return this.fetchHistory({
      conversationId: 'INBOX',
      credentials: input.credentials,
      channelState: input.channelState,
      scope: input.scope,
      limit: 50,
    } as FetchHistoryInput)
  }

  async resolveContact(input: ResolveContactInput): Promise<ContactHint | null> {
    return emailResolveContact(input)
  }
}

function parseUserCredentialsOrThrow(value: unknown): MicrosoftUserCredentials {
  const parsed = microsoftUserCredentialsSchema.safeParse(value)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`Invalid Microsoft credentials: ${first?.message ?? 'unknown validation error'}`)
  }
  return parsed.data
}

function parseClientCredentialsOrThrow(value: unknown): MicrosoftClientCredentials {
  const parsed = microsoftClientCredentialsSchema.safeParse(value)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`Invalid Microsoft OAuth client credentials: ${first?.message ?? 'unknown validation error'}`)
  }
  return parsed.data
}

let warnedLegacyClientPath = false

/**
 * Resolve the OAuth client config for a Microsoft refresh, preferring the new
 * `RefreshCredentialsInput.oauthClient` field (Spec A,
 * .ai/specs/2026-05-27-email-integration-inbound-reliability-and-threading.md).
 *
 * Falls back to the deprecated `credentials._client` read path for one
 * minor release so existing tests keep working. The legacy path emits a
 * one-time deprecation warning per process so production logs stay quiet.
 */
function resolveMicrosoftOAuthClient(input: RefreshCredentialsInput): MicrosoftClientCredentials {
  if (input.oauthClient) {
    const client = input.oauthClient
    if (!client.clientId) {
      throw new Error('Invalid Microsoft OAuth client credentials: OAuth Client ID required')
    }
    return {
      clientId: client.clientId,
      ...(client.tenantId !== undefined ? { tenantId: client.tenantId } : {}),
      ...(client.clientSecret !== undefined ? { clientSecret: client.clientSecret } : {}),
      ...(client.scopes !== undefined ? { scopes: client.scopes.join(' ') } : {}),
    }
  }
  // Legacy path — DEPRECATED. Remove in the next minor release.
  if (!warnedLegacyClientPath) {
    warnedLegacyClientPath = true
    console.warn(
      '[channel-microsoft] reading OAuth client config from credentials._client is deprecated;' +
        ' pass via RefreshCredentialsInput.oauthClient instead (Spec A).',
    )
  }
  return parseClientCredentialsOrThrow(
    (input.credentials as unknown as { _client?: unknown })._client ?? input.credentials,
  )
}

let cachedAdapter: MicrosoftChannelAdapter | null = null

export function getMicrosoftChannelAdapter(): MicrosoftChannelAdapter {
  if (!cachedAdapter) cachedAdapter = new MicrosoftChannelAdapter()
  return cachedAdapter
}

export { MicrosoftChannelAdapter }
