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
   * encode their own incremental cursor (Gmail historyId, Microsoft delta link,
   * IMAP UIDVALIDITY+UIDNEXT) here. The polling worker persists `HistoryPage
   * .nextCursor` between ticks and replays it on the following `fetchHistory`
   * call as `channelState`. A missing or empty value means "first poll — start
   * from the beginning / bootstrap the cursor".
   */
  channelState?: Record<string, unknown>
}

export interface HistoryPage {
  messages: NormalizedInboundMessage[]
  nextCursor?: string
  hasMore: boolean
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

export interface RefreshCredentialsInput {
  channelId: string
  credentials: Record<string, unknown>
  scope: TenantScope
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

  /** Declare supported features */
  readonly capabilities: ChannelCapabilities

  // Required core methods
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>
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
   * Required for OAuth providers (Gmail, Microsoft 365); omitted for static-credential
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
