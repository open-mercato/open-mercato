import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
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
import { baseEmailCapabilities } from './email-capabilities'
import { hasChannelAdapter, registerChannelAdapter } from './adapter-registry-singleton'
import { registerSystemEmailProviderConfigResolver } from './system-email-provider-config'

/**
 * Test-only channel seeding support.
 *
 * The ephemeral integration harness cannot connect a REAL email channel:
 *   - IMAP/SMTP `validateCredentials` performs a live LOGIN against a mail server
 *     (none exists in CI), so `POST /channels/connect/credentials` returns 422.
 *   - Even with a connected channel, the outbound delivery worker calls the real
 *     SMTP adapter, which fails with no server — so `communication_channels.message.sent`
 *     never fires and the customers link subscriber never runs.
 *
 * To make the compose → deliver → `.sent` → CRM-link → cross-user-visibility chain
 * (TC-CRM-EMAIL-001) and the inbound auto-link chain (TC-CRM-EMAIL-002..005) runnable
 * end-to-end against real Postgres, this module provides a network-free stub adapter
 * that is registered ONLY when `OM_ENABLE_TEST_CHANNEL_SEEDING` is set.
 *
 * Production safety: the registration is gated by {@link isTestChannelSeedingEnabled};
 * when the env flag is unset (the production default) the adapter is never registered
 * and the `__test_seed__` provider key resolves to no adapter — so the connect route
 * returns 404 `no_adapter` exactly as it would for any unknown provider. The dedicated
 * test-seed API route enforces the same gate independently (fail-closed 404 in prod).
 */

/** Provider key for the network-free test stub adapter. */
export const TEST_SEED_PROVIDER_KEY = '__test_seed__'

/**
 * Provider key for the network-free stub adapter that stands in for a CHAT
 * provider — one whose senders are identified by an opaque handle and have no
 * email address at all (Discord, Slack, Telegram…).
 *
 * It exists because the email-shaped stub above can only ever prove the hub
 * accepts email-shaped data. That is precisely how CI stayed green while every
 * real inbound Discord message was rejected (#4975): the fixture invented an
 * address the provider can never produce. Tests that need to prove the hub's
 * non-email identity contract MUST drive this provider instead.
 */
export const TEST_SEED_CHAT_PROVIDER_KEY = '__test_seed_chat__'

/** Env flag that unlocks test-only channel seeding. Off in production. */
export const TEST_CHANNEL_SEEDING_ENV = 'OM_ENABLE_TEST_CHANNEL_SEEDING'
export const TEST_EMAIL_CAPTURE_ACCESS_TOKEN_ENV = 'OM_TEST_EMAIL_CAPTURE_ACCESS_TOKEN'
export const TEST_EMAIL_CAPTURE_CORRELATION_TOKEN_ENV = 'OM_TEST_EMAIL_CAPTURE_CORRELATION_TOKEN'
/**
 * Where the Hub's tenant-scoped capture is written.
 *
 * Deliberately not `OM_TEST_EMAIL_CAPTURE_PATH`: that one belongs to the unscoped capture in
 * `@open-mercato/shared/lib/email/send`, which writes a different record shape to a path the repo
 * also ships a committed fixture for. Pointing both mechanisms at one file made this module parse
 * foreign records and let `clear-capture` rewrite the other mechanism's fixtures. Two mechanisms,
 * two files.
 */
export const TEST_SYSTEM_EMAIL_CAPTURE_PATH_ENV = 'OM_TEST_SYSTEM_EMAIL_CAPTURE_PATH'

/**
 * True only when the test-seeding env flag is explicitly enabled. Accepts the
 * usual truthy tokens (`1`, `true`, `yes`, `on`) so the harness can opt in via a
 * plain `=true`. Any other value (including unset) is treated as disabled.
 */
export function isTestChannelSeedingEnabled(): boolean {
  const raw = process.env[TEST_CHANNEL_SEEDING_ENV]
  if (typeof raw !== 'string') return false
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

export type TestSeedCapturedMessage = {
  capturedAt: string
  externalMessageId: string
  conversationId?: string
  content: SendMessageInput['content']
  scope: SendMessageInput['scope']
  metadata?: SendMessageInput['metadata']
  captureCorrelationToken?: string
}

type TestSeedCaptureScope = {
  tenantId: string
  organizationId: string | null
}

export type TestSeedCaptureOptions = {
  systemRecipient?: string
  captureCorrelationToken?: string
}

export async function createTestSeedPlatformMessage(
  em: EntityManager,
  input: {
    providerKey: string
    threadId?: string
    senderUserId: string
    subject?: string
    bodyText?: string
    channelId: string
    tenantId: string
    organizationId: string | null
  },
): Promise<string | null> {
  const rows = (await em.getConnection().execute(
    `INSERT INTO messages
       (type, thread_id, sender_user_id, subject, body, body_format, priority, status,
        is_draft, sent_at, visibility, source_entity_type, source_entity_id,
        tenant_id, organization_id, created_at, updated_at)
     VALUES
       (?, ?, ?, ?, ?, 'text', 'normal', 'sent',
        false, now(), 'public', 'communication_channels.test_seed_inbound', ?,
        ?, ?, now(), now())
     RETURNING id`,
    [
      `channel.${input.providerKey}`,
      input.threadId ?? null,
      input.senderUserId,
      input.subject ?? '(no subject)',
      input.bodyText ?? '',
      input.channelId,
      input.tenantId,
      input.organizationId,
    ],
  )) as Array<{ id: string }>
  return rows[0]?.id ?? null
}

function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length >= 32 ? normalized : null
}

export function isTestEmailCaptureAccessAuthorized(providedToken: string | null): boolean {
  const expectedToken = normalizeToken(process.env[TEST_EMAIL_CAPTURE_ACCESS_TOKEN_ENV])
  const normalizedProvidedToken = normalizeToken(providedToken)
  if (!expectedToken || !normalizedProvidedToken) return false
  const expected = Buffer.from(expectedToken)
  const provided = Buffer.from(normalizedProvidedToken)
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}

export function resolveTestEmailCaptureCorrelationToken(): string | null {
  return normalizeToken(process.env[TEST_EMAIL_CAPTURE_CORRELATION_TOKEN_ENV])
}

function resolveCapturePath(): string {
  const explicit = process.env[TEST_SYSTEM_EMAIL_CAPTURE_PATH_ENV]?.trim()
  if (explicit) return path.resolve(explicit)
  const queueBaseDir = process.env.QUEUE_BASE_DIR?.trim()
  if (queueBaseDir) return path.resolve(queueBaseDir, '..', 'test-email-capture.jsonl')
  return path.resolve(process.cwd(), '.mercato', 'test-email-capture.jsonl')
}

function matchesCaptureScope(
  message: TestSeedCapturedMessage,
  scope: TestSeedCaptureScope,
  options: TestSeedCaptureOptions = {},
): boolean {
  if (message.scope.tenantId === scope.tenantId) {
    const messageOrganizationId = message.scope.organizationId ?? null
    return messageOrganizationId === scope.organizationId || messageOrganizationId === scope.tenantId
  }

  if (
    message.scope.tenantId !== 'system' ||
    message.scope.organizationId !== 'system' ||
    !options.systemRecipient ||
    !options.captureCorrelationToken ||
    message.captureCorrelationToken !== options.captureCorrelationToken
  ) {
    return false
  }

  const expectedRecipient = options.systemRecipient.trim().toLowerCase()
  const matchesRecipient = (value: unknown): boolean => {
    if (typeof value === 'string') return value.trim().toLowerCase() === expectedRecipient
    if (Array.isArray(value)) return value.some(matchesRecipient)
    if (!value || typeof value !== 'object') return false
    return matchesRecipient((value as Record<string, unknown>).address)
  }

  return matchesRecipient(message.metadata?.to)
}

async function readTestSeedCapturedMessages(): Promise<TestSeedCapturedMessage[]> {
  const capturePath = resolveCapturePath()
  const text = await readFile(capturePath, 'utf8').catch(() => '')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as TestSeedCapturedMessage
      } catch {
        return null
      }
    })
    // A record without a scope is not ours. Skipping instead of throwing keeps a stray or
    // foreign-shaped line from turning every capture read into a 500.
    .filter((message): message is TestSeedCapturedMessage => Boolean(message?.scope))
}

export async function clearTestSeedCapturedMessages(
  scope: TestSeedCaptureScope,
  options: TestSeedCaptureOptions = {},
): Promise<void> {
  const capturePath = resolveCapturePath()
  const retained = (await readTestSeedCapturedMessages())
    .filter((message) => !matchesCaptureScope(message, scope, options))
  if (retained.length === 0) {
    await rm(capturePath, { force: true })
    return
  }
  await writeFile(
    capturePath,
    `${retained.map((message) => JSON.stringify(message)).join('\n')}\n`,
    'utf8',
  )
}

export async function listTestSeedCapturedMessages(
  scope: TestSeedCaptureScope,
  options: TestSeedCaptureOptions = {},
): Promise<TestSeedCapturedMessage[]> {
  return (await readTestSeedCapturedMessages()).filter((message) =>
    matchesCaptureScope(message, scope, options),
  )
}

async function captureTestSeedMessage(record: TestSeedCapturedMessage): Promise<void> {
  const capturePath = resolveCapturePath()
  await mkdir(path.dirname(capturePath), { recursive: true })
  await appendFile(capturePath, `${JSON.stringify(record)}\n`, 'utf8')
}

/**
 * Capabilities for the stub: an email channel that supports neither reactions,
 * edit/delete, nor conversation history — so the strict registry validator
 * (`validateAdapterCapabilities`) requires only the core method surface.
 */
const testSeedCapabilities: ChannelCapabilities = {
  ...baseEmailCapabilities,
  conversationHistory: false,
  realtimePush: false,
}

/**
 * A `ChannelAdapter` whose `sendMessage` reports a successful send WITHOUT any
 * network I/O. Used exclusively by the integration harness to let the outbound
 * delivery worker reach its success path and emit `communication_channels.message.sent`.
 */
class TestSeedChannelAdapter implements ChannelAdapter {
  // Widened to `string` rather than inferred as a literal so the chat-flavoured
  // subclass below can override both with its own provider key / channel type.
  readonly providerKey: string = TEST_SEED_PROVIDER_KEY
  readonly channelType: string = 'email'
  readonly capabilities = testSeedCapabilities

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    // Synthesize a deterministic-looking RFC2822-style message id; never touches
    // the network. The delivery worker persists this as the external message id.
    const externalMessageId = `test-seed-${Date.now()}-${Math.random().toString(16).slice(2, 10)}@test-seed.local`
    await captureTestSeedMessage({
      capturedAt: new Date().toISOString(),
      externalMessageId,
      conversationId: input.conversationId,
      content: input.content,
      scope: input.scope,
      metadata: input.metadata,
      captureCorrelationToken: resolveTestEmailCaptureCorrelationToken() ?? undefined,
    })
    return {
      externalMessageId,
      conversationId: input.conversationId,
      status: 'sent',
      metadata: { testSeed: true },
    }
  }

  async verifyWebhook(_input: VerifyWebhookInput): Promise<InboundMessage> {
    // No real webhook — return the inert event so the generic webhook route 202s
    // without enqueuing tenant-scoped work (mirrors the IMAP adapter contract).
    return { raw: {}, eventType: 'other', metadata: { reason: 'test-seed-no-webhook' } }
  }

  async getStatus(_input: GetMessageStatusInput): Promise<MessageStatus> {
    return { status: 'sent' }
  }

  async convertOutbound(input: ConvertOutboundInput): Promise<ChannelNativeContent> {
    return {
      content: {
        text: input.body,
        bodyFormat: input.bodyFormat,
      },
      metadata: input.channelMetadata ?? {},
    }
  }

  async normalizeInbound(_raw: InboundMessage): Promise<NormalizedInboundMessage> {
    // The test-seed inbound path seeds MessageChannelLink rows directly and emits
    // the hub event, so this adapter never normalizes a raw inbound payload.
    throw new Error('[internal] TestSeedChannelAdapter.normalizeInbound is not used by the seed harness')
  }

  async validateCredentials(_input: ValidateCredentialsInput): Promise<ValidateCredentialsResult> {
    // No real server to authenticate against — accept any credentials so the
    // connect command persists a connected channel.
    return { ok: true }
  }
}

/**
 * Capabilities for the chat stub. Identical to the email stub's except for the
 * recipient shape: a chat channel is addressed by a provider-issued identifier
 * (a Discord snowflake), not an email address.
 *
 * Without this override the chat stub inherited `baseEmailCapabilities`, so it
 * claimed `channelType: 'discord'` while validating recipients as email
 * addresses — a channel that could not be addressed the way the provider it
 * imitates actually is. That left the hub's `'provider-native'` branch
 * (#4976: per-provider recipient validation, and the omitted recipient that
 * falls back to the adapter's own target) reachable only with a live Discord
 * bot, so no integration test could cover it and CI never exercised it.
 */
const testSeedChatCapabilities: ChannelCapabilities = {
  ...testSeedCapabilities,
  recipientFormat: 'provider-native',
}

/**
 * Chat-flavoured twin of {@link TestSeedChannelAdapter}: same network-free
 * behaviour, but it declares a non-email `channelType`, so a channel connected
 * through it is shaped like a real chat channel — including an
 * `externalIdentifier` of NULL when no email-ish credential key is supplied.
 */
class TestSeedChatChannelAdapter extends TestSeedChannelAdapter {
  readonly providerKey: string = TEST_SEED_CHAT_PROVIDER_KEY
  readonly channelType: string = 'discord'
  readonly capabilities = testSeedChatCapabilities

  async normalizeInbound(raw: InboundMessage): Promise<NormalizedInboundMessage> {
    // Unlike the email stub, this one is reachable: the test-seed ingest action
    // feeds it a chat-shaped frame so the message travels the real ingest path
    // (and therefore the real compose validation) rather than a SQL shortcut.
    const frame = (raw.raw ?? {}) as Record<string, unknown>
    const senderIdentifier = String(frame.senderIdentifier ?? '')
    if (!senderIdentifier) {
      throw new Error('[internal] TestSeedChatChannelAdapter requires a senderIdentifier')
    }
    return {
      externalMessageId: String(frame.externalMessageId ?? ''),
      externalConversationId: String(frame.externalConversationId ?? ''),
      senderIdentifier,
      senderDisplayName:
        typeof frame.senderDisplayName === 'string' ? frame.senderDisplayName : undefined,
      body: typeof frame.body === 'string' ? frame.body : '',
      bodyFormat: 'text',
      timestamp: new Date(),
      channelPayload: {},
      channelContentType: 'text/plain',
      channelMetadata: {},
    }
  }
}

let cachedTestSeedAdapter: TestSeedChannelAdapter | null = null
let cachedTestSeedChatAdapter: TestSeedChatChannelAdapter | null = null

function getTestSeedChannelAdapter(): TestSeedChannelAdapter {
  if (!cachedTestSeedAdapter) cachedTestSeedAdapter = new TestSeedChannelAdapter()
  return cachedTestSeedAdapter
}

function getTestSeedChatChannelAdapter(): TestSeedChatChannelAdapter {
  if (!cachedTestSeedChatAdapter) cachedTestSeedChatAdapter = new TestSeedChatChannelAdapter()
  return cachedTestSeedChatAdapter
}

/**
 * Register the test-seed adapter exactly once, but ONLY when the env flag is set.
 * Idempotent and safe to call from every container creation (`di.register`) — a
 * no-op when seeding is disabled or the adapter is already registered.
 */
export function ensureTestSeedAdapterRegistered(): void {
  if (!isTestChannelSeedingEnabled()) return
  registerSystemEmailProviderConfigResolver({
    providerKey: TEST_SEED_PROVIDER_KEY,
    isConfigured: isTestChannelSeedingEnabled,
    resolveCredentials: ({ fromAddress }) => ({ testSeed: true, fromAddress }),
  })
  if (!hasChannelAdapter(TEST_SEED_PROVIDER_KEY)) {
    registerChannelAdapter(getTestSeedChannelAdapter())
  }
  if (!hasChannelAdapter(TEST_SEED_CHAT_PROVIDER_KEY)) {
    registerChannelAdapter(getTestSeedChatChannelAdapter())
  }
}
