import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
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

/** Env flag that unlocks test-only channel seeding. Off in production. */
export const TEST_CHANNEL_SEEDING_ENV = 'OM_ENABLE_TEST_CHANNEL_SEEDING'

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
}

type TestSeedCaptureScope = {
  tenantId: string
  organizationId: string | null
}

function resolveCapturePath(): string {
  const explicit = process.env.OM_TEST_EMAIL_CAPTURE_PATH?.trim()
  if (explicit) return path.resolve(explicit)
  const queueBaseDir = process.env.QUEUE_BASE_DIR?.trim()
  if (queueBaseDir) return path.resolve(queueBaseDir, '..', 'test-email-capture.jsonl')
  return path.resolve(process.cwd(), '.mercato', 'test-email-capture.jsonl')
}

function matchesCaptureScope(
  message: TestSeedCapturedMessage,
  scope: TestSeedCaptureScope,
): boolean {
  return (
    message.scope.tenantId === scope.tenantId &&
    (message.scope.organizationId ?? null) === scope.organizationId
  )
}

async function readTestSeedCapturedMessages(): Promise<TestSeedCapturedMessage[]> {
  const capturePath = resolveCapturePath()
  const text = await readFile(capturePath, 'utf8').catch(() => '')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as TestSeedCapturedMessage)
}

export async function clearTestSeedCapturedMessages(scope: TestSeedCaptureScope): Promise<void> {
  const capturePath = resolveCapturePath()
  const retained = (await readTestSeedCapturedMessages())
    .filter((message) => !matchesCaptureScope(message, scope))
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
): Promise<TestSeedCapturedMessage[]> {
  return (await readTestSeedCapturedMessages()).filter((message) =>
    matchesCaptureScope(message, scope),
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
  readonly providerKey = TEST_SEED_PROVIDER_KEY
  readonly channelType = 'email'
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

let cachedTestSeedAdapter: TestSeedChannelAdapter | null = null

function getTestSeedChannelAdapter(): TestSeedChannelAdapter {
  if (!cachedTestSeedAdapter) cachedTestSeedAdapter = new TestSeedChannelAdapter()
  return cachedTestSeedAdapter
}

/**
 * Register the test-seed adapter exactly once, but ONLY when the env flag is set.
 * Idempotent and safe to call from every container creation (`di.register`) — a
 * no-op when seeding is disabled or the adapter is already registered.
 */
export function ensureTestSeedAdapterRegistered(): void {
  if (!isTestChannelSeedingEnabled()) return
  if (hasChannelAdapter(TEST_SEED_PROVIDER_KEY)) return
  registerChannelAdapter(getTestSeedChannelAdapter())
}
