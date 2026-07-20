/**
 * ChannelAdapter — the contract every channel provider implements (Slack, WhatsApp, Email…).
 *
 * This is the FIRST implementation. There is no v1 in shipping code; provider packages
 * implement this interface directly. See SPEC-045d §1.1 and the Pre-Implementation
 * Analysis at .ai/specs/analysis/ANALYSIS-SPEC-045d-communication-notification-hubs.md.
 */

export interface TenantScope {
  organizationId: string
  tenantId: string
}

// ── Capabilities ──────────────────────────────────────────────

export interface ChannelCapabilities {
  // Core
  threading: boolean
  richText: boolean
  fileSharing: boolean
  maxFileSize?: number
  supportedMimeTypes?: string[]
  readReceipts: boolean
  deliveryReceipts: boolean
  typingIndicators: boolean

  // Extended
  reactions: boolean
  multiReactionPerUser: boolean
  editMessage: boolean
  deleteMessage: boolean
  presence: boolean
  richBlocks: boolean
  interactiveComponents: boolean
  inlineImages: boolean
  conversationHistory: boolean
  contactCards: boolean
  locationSharing: boolean
  voiceNotes: boolean
  stickers: boolean

  // Content format support
  supportedBodyFormats: Array<'text' | 'markdown' | 'html'>
  maxBodyLength?: number

  /**
   * If `false`, the provider does not support real-time push; the hub schedules polling.
   * Optional; existing chat providers (Slack, WhatsApp) omit and are treated as `true`.
   */
  realtimePush?: boolean
}

// ── Send / status / sender listing ────────────────────────────

export interface SendMessageInput {
  conversationId?: string
  content: MessageContent
  credentials: Record<string, unknown>
  scope: TenantScope
  metadata?: Record<string, unknown>
}

export interface MessageContent {
  text?: string
  html?: string
  bodyFormat?: 'text' | 'markdown' | 'html'
  attachments?: Array<{ url: string; mimeType: string; fileName: string; fileSize?: number; inline?: boolean }>
  raw?: Record<string, unknown>
}

export interface SendMessageResult {
  externalMessageId: string
  conversationId?: string
  status: 'sent' | 'queued' | 'failed'
  error?: string
  metadata?: Record<string, unknown>
}

export interface VerifyWebhookInput {
  rawBody: string | Buffer
  headers: Record<string, string | string[] | undefined>
  credentials: Record<string, unknown>
  scope: TenantScope
}

export interface InboundMessage {
  raw: Record<string, unknown>
  eventType?: 'message' | 'reaction' | 'status_update' | 'other'
  metadata?: Record<string, unknown>
}

export interface GetMessageStatusInput {
  externalMessageId: string
  credentials: Record<string, unknown>
  scope: TenantScope
}

export interface MessageStatus {
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  deliveredAt?: Date
  readAt?: Date
  error?: string
}

export interface ListSendersInput {
  credentials: Record<string, unknown>
  scope: TenantScope
}

export interface SenderInfo {
  id: string
  displayName?: string
  identifier?: string
}

// ── Conversion (outbound) ─────────────────────────────────────

export interface ConvertOutboundInput {
  body: string
  bodyFormat: 'text' | 'markdown' | 'html'
  attachments?: NormalizedAttachment[]
  channelMetadata?: Record<string, unknown>
}

export interface ChannelNativeContent {
  content: MessageContent
  metadata?: Record<string, unknown>
}

// ── Normalization (inbound) ───────────────────────────────────

export interface NormalizedInboundMessage {
  externalMessageId: string
  externalConversationId: string
  senderIdentifier: string
  senderDisplayName?: string
  senderAvatarUrl?: string
  subject?: string
  body: string
  bodyFormat: 'text' | 'markdown' | 'html'
  attachments?: NormalizedAttachment[]
  timestamp: Date
  replyToExternalId?: string
  channelPayload: Record<string, unknown>
  channelContentType: string
  channelMetadata: Record<string, unknown>
  reactions?: InboundReaction[]
}

export interface NormalizedAttachment {
  url: string
  mimeType: string
  fileName: string
  fileSize?: number
  inline?: boolean
}

export interface InboundReaction {
  emoji: string
  userIdentifier: string
  userDisplayName?: string
  timestamp?: Date
}

// ── Inbound reaction normalization ───────────────────────────

/**
 * Normalized inbound reaction event — produced by `adapter.normalizeInboundReaction?(raw)`
 * when a provider's webhook delivers a reaction add/remove event distinct from a message.
 *
 * Some providers bundle reactions inside `NormalizedInboundMessage.reactions`
 * (history sync use case); others deliver them as standalone webhook events
 * (`reaction_added` / `reaction_removed`). For the standalone path, the adapter
 * is responsible for producing this normalized shape.
 */
export interface InboundReactionEvent {
  /** External message id the reaction was applied to (FK lookup target). */
  externalMessageId: string
  /** Optional external conversation id — provider-specific context. */
  externalConversationId?: string
  /** Provider's reaction event identifier (for sync + de-dup). */
  externalReactionId?: string
  /** Emoji — Slack shortcode (`thumbsup`) or unicode (`👍`). */
  emoji: string
  /** External sender id (Slack user id, phone, email). */
  userIdentifier: string
  /** External sender display name. */
  userDisplayName?: string
  /** Whether the reaction was added or removed. */
  action: 'added' | 'removed'
  /** Provider timestamp; falls back to current time if missing. */
  timestamp?: Date
  /** Optional raw payload for diagnostics. */
  raw?: Record<string, unknown>
}

// ── Reactions ─────────────────────────────────────────────────

export interface SendReactionInput {
  externalMessageId: string
  conversationId: string
  emoji: string
  credentials: Record<string, unknown>
  scope: TenantScope
}

export interface RemoveReactionInput {
  externalMessageId: string
  conversationId: string
  emoji: string
  credentials: Record<string, unknown>
  scope: TenantScope
}

// ── Edit / delete ─────────────────────────────────────────────

export interface EditChannelMessageInput {
  externalMessageId: string
  conversationId: string
  newContent: MessageContent
  credentials: Record<string, unknown>
  scope: TenantScope
}

export interface DeleteChannelMessageInput {
  externalMessageId: string
  conversationId: string
  credentials: Record<string, unknown>
  scope: TenantScope
}

// ── History ──────────────────────────────────────────────────

export interface FetchHistoryInput {
  conversationId: string
  credentials: Record<string, unknown>
  cursor?: string
  limit?: number
  scope: TenantScope
  /**
   * Provider-specific resumption state opaque to the hub. Provider adapters
   * encode their own incremental cursor (Gmail historyId, IMAP
   * UIDVALIDITY+UIDNEXT) here. The polling worker persists `HistoryPage
   * .nextCursor` between ticks and replays it on the following `fetchHistory`
   * call as `channelState`. A missing or empty value means "first poll — start
   * from the beginning / bootstrap the cursor".
   */
  channelState?: Record<string, unknown>
  /**
   * Optional contact-filter hint. When provided, the adapter SHOULD prefer
   * server-side filtering (e.g. IMAP `SEARCH OR FROM …`, Gmail `q=from:…`) to
   * narrow the fetch to messages whose sender matches one of the listed
   * addresses, instead of pulling the whole mailbox and discarding non-matches.
   *
   * The hub passes the union of all CRM contact addresses for the channel's
   * tenant/org — typically tens, occasionally hundreds. Adapters that don't
   * support server-side sender filtering can ignore the hint (back-compat).
   *
   * `sinceDays` further narrows by message date (server-side `SINCE` for IMAP,
   * `after:` for Gmail). Default 30 days when omitted by caller, capped at 365.
   */
  contactFilter?: {
    addresses: string[]
    sinceDays?: number
  }
}

export interface HistoryPage {
  messages: NormalizedInboundMessage[]
  nextCursor?: string
  hasMore: boolean
}

// ── Provider push delivery (Spec C) ──────────────────────────

/**
 * Result of `adapter.registerPush(...)`. The adapter returns provider-specific
 * cursor / expiry data; the hub persists the relevant fields onto
 * `CommunicationChannel.channelState` (JSONB, additive shape per provider).
 *
 * Gmail: `historyId` + `watchExpirationMs` + `pubsubTopic`.
 */
export interface PushRegistration {
  providerKey: string
  /** Whether registration succeeded enough to switch to push delivery. */
  status: 'active' | 'failed'
  /** Provider-specific state to merge into `channel.channelState`. */
  channelStatePatch: Record<string, unknown>
  /**
   * When push registration succeeds and the channel can switch to longer poll
   * cadence. The hub typically uses 1800 (30 min) as a belt-and-suspenders
   * fallback. Undefined means "leave the existing cadence".
   */
  recommendedPollIntervalSeconds?: number
  /** Operator-visible diagnostic, populated when `status='failed'`. */
  error?: { code: string; message: string }
}

export interface RegisterPushInput {
  channelId: string
  credentials: Record<string, unknown>
  scope: TenantScope
  /** Public URL the provider should POST notifications to. */
  notificationUrl: string
  /** Provider-specific tenant configuration (e.g. Gmail Pub/Sub topic). */
  providerConfig?: Record<string, unknown>
}

export interface UnregisterPushInput {
  channelId: string
  credentials: Record<string, unknown>
  scope: TenantScope
  /** Persisted channel state at the time of unregister (provider needs IDs). */
  channelState: Record<string, unknown>
}

/**
 * Verified inbound push notification (Gmail Pub/Sub envelope). The hub's
 * webhook routes do JWT verification BEFORE invoking the adapter; the adapter
 * receives the verified payload only.
 */
export interface ApplyPushNotificationInput {
  credentials: Record<string, unknown>
  scope: TenantScope
  channelState: Record<string, unknown>
  /** Provider-shaped notification payload. */
  notification: Record<string, unknown>
}

// ── Import history (operator-triggered backlog) ──────────────

/**
 * Operator-triggered historical import. Distinct from `fetchHistory`:
 *   - `fetchHistory` runs every poll and ingests *new* mail since the cursor
 *     (zero-history bootstrap by construction — Spec B § Phase B4).
 *   - `importHistory` is invoked by the explicit `/import-history` endpoint
 *     (Spec B § Phase B6) and reaches *backwards in time* into the mailbox
 *     to pull older messages the channel never observed at bootstrap.
 *
 * Adapters that cannot perform historical imports (e.g. write-only providers)
 * omit this method; the hub returns a 400 "feature not supported" envelope.
 */
export interface ImportHistoryInput {
  credentials: Record<string, unknown>
  scope: TenantScope
  /** Look back at most this many days. Clamped 1..365 by the hub. */
  sinceDays: number
  /**
   * Optional sender-filter hint. Adapters SHOULD use it for server-side
   * filtering (IMAP `SEARCH OR FROM …`, Gmail `q=from:…`). When omitted the
   * import scans the entire `SINCE` window.
   */
  contactEmails?: string[]
  /** Total cap across all pages. Hub default 1000. Adapter MUST respect. */
  maxMessages?: number
  /** Opaque resumption cursor returned by the previous page. */
  cursor?: string
}

export interface ImportHistoryPage {
  messages: NormalizedInboundMessage[]
  nextCursor?: string
  hasMore: boolean
  /**
   * Optional total of candidate messages discovered server-side. When
   * present, the hub uses it to populate the `ProgressJob.totalCount` on
   * the first page so the operator sees an accurate progress bar.
   */
  totalCandidates?: number
}

// ── Contact resolution ───────────────────────────────────────

export interface ResolveContactInput {
  senderIdentifier: string
  senderDisplayName?: string
  channelMetadata?: Record<string, unknown>
  credentials: Record<string, unknown>
  scope: TenantScope
}

export interface ContactHint {
  email?: string
  phone?: string
  displayName?: string
  avatarUrl?: string
  externalProfileUrl?: string
  matchedPersonId?: string
  matchedCompanyId?: string
}

// ── OAuth (per-user) ─────────────────────────────────────────

export interface BuildOAuthAuthorizeUrlInput {
  /** Opaque state nonce minted by the hub; the adapter MUST embed it as `state=…`. */
  state: string
  /** Per-user CSRF nonce — provider-specific use (e.g. Google's `nonce`). */
  nonce: string
  /** Where the provider should send the user after consent. */
  redirectUri: string
  /** Per-tenant OAuth client configuration (client_id / client_secret / scopes). */
  credentials: Record<string, unknown>
  scope: TenantScope
  /** Optional login hint (e.g. user's email address) — providers that honour it. */
  loginHint?: string
}

export interface BuildOAuthAuthorizeUrlResult {
  /** Full authorize URL the user should be redirected to. */
  authorizeUrl: string
  /** Provider-specific extras to embed in the hub's state cookie (PKCE verifier, scopes, …). */
  extra?: Record<string, unknown>
}

export interface ExchangeOAuthCodeInput {
  /** Authorization code returned by the provider on the callback. */
  code: string
  /** Where the provider was told to redirect — must match the initiate call. */
  redirectUri: string
  /** Per-tenant OAuth client configuration. */
  credentials: Record<string, unknown>
  scope: TenantScope
  /** Extras the hub stored in the state cookie at `initiate` time (PKCE verifier, …). */
  stateExtra?: Record<string, unknown>
}

export interface ExchangeOAuthCodeResult {
  /** Credentials blob to persist (encrypted by the hub) — access_token, refresh_token, expiresAt. */
  credentials: Record<string, unknown>
  /** External identifier (e.g. user's email) → `CommunicationChannel.externalIdentifier`. */
  externalIdentifier?: string
  /** Suggested display name for the new channel. */
  displayName?: string
  /** Optional access-token expiry timestamp. */
  expiresAt?: Date
}

// ── Credential refresh + validation ──────────────────────────

/**
 * Tenant-level OAuth client configuration resolved by the hub from
 * `integration_credentials.scope = channel_<providerKey>`.
 *
 * OAuth providers (Gmail) MUST read clientId / clientSecret from this field on
 * `RefreshCredentialsInput`. Adapters without OAuth refresh (IMAP, WhatsApp
 * Business API) ignore it.
 *
 * See `.ai/specs/implemented/2026-05-27-email-integration-inbound-reliability-and-threading.md`.
 */
export interface OAuthClientConfig {
  clientId: string
  clientSecret?: string
  /** Optional pre-resolved scopes list (some flows compute it once on initiate). */
  scopes?: string[]
}

export interface RefreshCredentialsInput {
  channelId: string
  credentials: Record<string, unknown>
  scope: TenantScope
  /**
   * Tenant-level OAuth client configuration. Resolved by the hub's
   * `refreshCredentialsIfNeeded` helper before delegating to the adapter.
   *
   * - For OAuth providers (Gmail): MUST be present; the adapter uses
   *   `clientId` + `clientSecret` to call the provider's token endpoint.
   * - For static-credential providers (IMAP, WhatsApp): ignored.
   * - When `undefined`: legacy `credentials._client` path is read by the
   *   adapter (deprecated; will be removed in the next minor release).
   */
  oauthClient?: OAuthClientConfig
}

export interface RefreshedCredentials {
  credentials: Record<string, unknown>
  expiresAt?: Date
}

export interface ValidateCredentialsInput {
  providerKey: string
  credentials: Record<string, unknown>
  scope: TenantScope
}

export interface ValidateCredentialsResult {
  ok: boolean
  /** Field-level error messages keyed by credential field name; for `createCrudFormError`. */
  errors?: Record<string, string>
}

// ── The adapter contract ─────────────────────────────────────

export interface ChannelAdapter {
  readonly providerKey: string
  readonly channelType: 'whatsapp' | 'slack' | 'email' | 'sms' | string

  /**
   * Scope of a connected channel for this provider. Governs whether the connect
   * flow stamps `CommunicationChannel.user_id` with the connecting user or leaves
   * it NULL (tenant-wide):
   *
   * - `'user'` (default when absent) — one channel per user (Gmail, IMAP). The
   *   credential belongs to the connecting user.
   * - `'tenant'` — one shared channel per tenant (`user_id = NULL`), connected by
   *   an admin. Used by push providers (FCM/APNs/Expo) whose service account /
   *   signing key serves every device in the tenant. Reading (fan-out/delivery)
   *   is already scope-agnostic; this only affects the connect/write path.
   *
   * ADDITIVE-ONLY (BACKWARD_COMPATIBILITY.md): existing adapters that omit it keep
   * their per-user behaviour unchanged.
   */
  readonly channelScope?: 'tenant' | 'user'

  /** Declare supported features */
  readonly capabilities: ChannelCapabilities

  // Required core methods
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>
  /**
   * Verify an inbound webhook against the supplied channel credentials and
   * normalize it to an {@link InboundMessage}.
   *
   * SECURITY CONTRACT (fail-closed): implementations MUST throw when the request
   * cannot be cryptographically verified for `input.credentials`. The generic
   * `api/post/webhook/[provider]` route treats a non-throwing return as
   * "verified" and pins the request to that candidate channel's tenant, so a
   * best-effort / no-op implementation that returns normally on an unverified
   * request is a tenant-spoofing fail-open. Adapters with no real webhook (IMAP
   * polling, or a provider handled by a dedicated signed route) MUST return
   * `eventType: 'other'` so the route acknowledges (202) without enqueuing any
   * tenant-scoped work.
   */
  verifyWebhook(input: VerifyWebhookInput): Promise<InboundMessage>
  getStatus(input: GetMessageStatusInput): Promise<MessageStatus>
  convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent>
  normalizeInbound(raw: InboundMessage): Promise<NormalizedInboundMessage>

  // Optional extensions
  listSenders?(input: ListSendersInput): Promise<SenderInfo[]>

  /**
   * Normalize a raw inbound reaction webhook event into the canonical `InboundReactionEvent`.
   * Required for providers that deliver standalone reaction events. Providers that only
   * bundle reactions inside `NormalizedInboundMessage.reactions` can omit this method —
   * standalone reaction webhooks for those providers are reported as 202 "not handled".
   */
  normalizeInboundReaction?(raw: InboundMessage): Promise<InboundReactionEvent>

  sendReaction?(input: SendReactionInput): Promise<void>
  removeReaction?(input: RemoveReactionInput): Promise<void>
  editMessage?(input: EditChannelMessageInput): Promise<void>
  deleteMessage?(input: DeleteChannelMessageInput): Promise<void>
  fetchHistory?(input: FetchHistoryInput): Promise<HistoryPage>

  /**
   * Operator-triggered historical import (Spec B § Phase B6). Returns a page
   * of older messages older than (or alongside) the channel's normal incremental
   * cursor. Pagination via `cursor` until `hasMore: false`. Adapters without
   * historical import omit this method.
   */
  importHistory?(input: ImportHistoryInput): Promise<ImportHistoryPage>

  /**
   * Spec C — Register provider push delivery for this channel.
   *
   * Gmail: calls `users.watch` against the configured Pub/Sub topic.
   *
   * Adapters that don't support push (IMAP, chat) omit this method; the hub
   * keeps the channel in polling mode (Spec B baseline).
   */
  registerPush?(input: RegisterPushInput): Promise<PushRegistration>

  /**
   * Spec C — Tear down a previously-registered push registration. Called on
   * channel disconnect, on re-auth, and during deactivation. Idempotent —
   * absence of provider-side registration is not an error.
   */
  unregisterPush?(input: UnregisterPushInput): Promise<void>

  /**
   * Spec C — Convert a verified inbound push notification into the same
   * `HistoryPage` shape `fetchHistory` returns. Gmail: calls `history.list`.
   * The hub's push workers feed each returned message through the existing
   * `ingest-inbound-message` command, so threading and dedup behave identically
   * to the polling path.
   */
  applyPushNotification?(input: ApplyPushNotificationInput): Promise<HistoryPage>
  resolveContact?(input: ResolveContactInput): Promise<ContactHint | null>

  /**
   * Build the authorize URL the user should be redirected to in the OAuth
   * "initiate" flow. The adapter MUST embed the hub-supplied `state` value in
   * the URL's `state` query parameter. Adapters that don't support OAuth
   * (IMAP, WhatsApp Business API) omit this method.
   */
  buildOAuthAuthorizeUrl?(
    input: BuildOAuthAuthorizeUrlInput,
  ): Promise<BuildOAuthAuthorizeUrlResult>

  /**
   * Exchange the OAuth authorization code returned on the callback for an
   * access token (and refresh token, when the provider supports it). Returns
   * the credential blob the hub should persist, plus the external identifier
   * (typically the user's email address) used to populate the new channel.
   */
  exchangeOAuthCode?(input: ExchangeOAuthCodeInput): Promise<ExchangeOAuthCodeResult>

  /**
   * Refresh OAuth credentials when an access token is near expiry or after a 401.
   * Required for OAuth providers (Gmail); omitted for static-credential
   * providers (IMAP, WhatsApp Business API).
   */
  refreshCredentials?(input: RefreshCredentialsInput): Promise<RefreshedCredentials>

  /**
   * Validate provided credentials at setup time before persisting. Returns
   * `{ ok: true }` on success, or `{ ok: false, errors }` for field-level errors.
   * Implemented by credential-based providers (IMAP/SMTP). OAuth providers
   * omit this — the OAuth callback proves credential validity.
   */
  validateCredentials?(input: ValidateCredentialsInput): Promise<ValidateCredentialsResult>
}
