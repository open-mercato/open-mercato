import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  TEST_CHANNEL_SEEDING_ENV,
  TEST_EMAIL_CAPTURE_ACCESS_TOKEN_ENV,
  TEST_EMAIL_CAPTURE_CORRELATION_TOKEN_ENV,
  TEST_SEED_CHAT_PROVIDER_KEY,
  TEST_SEED_PROVIDER_KEY,
  clearTestSeedCapturedMessages,
  ensureTestSeedAdapterRegistered,
  isTestChannelSeedingEnabled,
  isTestEmailCaptureAccessAuthorized,
  listTestSeedCapturedMessages,
  type TestSeedCapturedMessage,
} from '../test-seed'
import { clearChannelAdapters, hasChannelAdapter, getChannelAdapter } from '../registry'
import { getSystemEmailProviderConfigResolver } from '../system-email-provider-config'

describe('communication_channels test-seed gate', () => {
  const originalFlag = process.env[TEST_CHANNEL_SEEDING_ENV]
  const originalAccessToken = process.env[TEST_EMAIL_CAPTURE_ACCESS_TOKEN_ENV]

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[TEST_CHANNEL_SEEDING_ENV]
    else process.env[TEST_CHANNEL_SEEDING_ENV] = originalFlag
    if (originalAccessToken === undefined) delete process.env[TEST_EMAIL_CAPTURE_ACCESS_TOKEN_ENV]
    else process.env[TEST_EMAIL_CAPTURE_ACCESS_TOKEN_ENV] = originalAccessToken
    clearChannelAdapters()
  })

  describe('isTestChannelSeedingEnabled', () => {
    it('is false when the env flag is unset (production default)', () => {
      delete process.env[TEST_CHANNEL_SEEDING_ENV]
      expect(isTestChannelSeedingEnabled()).toBe(false)
    })

    it.each(['1', 'true', 'TRUE', 'yes', 'on', ' true '])(
      'is true for truthy token %p',
      (token) => {
        process.env[TEST_CHANNEL_SEEDING_ENV] = token
        expect(isTestChannelSeedingEnabled()).toBe(true)
      },
    )

    it.each(['0', 'false', 'no', 'off', '', 'enabled', 'maybe'])(
      'is false for non-truthy token %p',
      (token) => {
        process.env[TEST_CHANNEL_SEEDING_ENV] = token
        expect(isTestChannelSeedingEnabled()).toBe(false)
      },
    )
  })

  describe('ensureTestSeedAdapterRegistered', () => {
    it('does NOT register the stub adapter when the gate is off (prod safety)', () => {
      delete process.env[TEST_CHANNEL_SEEDING_ENV]
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      expect(hasChannelAdapter(TEST_SEED_PROVIDER_KEY)).toBe(false)
      expect(hasChannelAdapter(TEST_SEED_CHAT_PROVIDER_KEY)).toBe(false)
    })

    it('registers a non-email chat stub alongside the email one (#4975)', () => {
      process.env[TEST_CHANNEL_SEEDING_ENV] = 'true'
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      const adapter = getChannelAdapter(TEST_SEED_CHAT_PROVIDER_KEY)
      expect(adapter).toBeDefined()
      // The whole point: a stub whose channelType is NOT email, so a test can
      // prove the hub accepts a sender that has no address instead of feeding
      // it an invented one.
      expect(adapter?.channelType).not.toBe('email')
      expect(adapter?.capabilities.conversationHistory).toBe(false)
    })

    it('the chat stub normalizes a frame carrying no address at all', async () => {
      process.env[TEST_CHANNEL_SEEDING_ENV] = 'true'
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      const adapter = getChannelAdapter(TEST_SEED_CHAT_PROVIDER_KEY)

      const normalized = await adapter!.normalizeInbound({
        raw: {
          externalMessageId: 'chat-message-1',
          externalConversationId: 'chat-conversation-1',
          senderIdentifier: '1499156851487539260',
          senderDisplayName: 'Karol Kapsa',
          body: 'hello from a guild channel',
        },
        eventType: 'message',
        metadata: {},
      })

      expect(normalized.senderIdentifier).toBe('1499156851487539260')
      expect(JSON.stringify(normalized)).not.toContain('@')
      expect((normalized as { subject?: string }).subject).toBeUndefined()
    })

    it('registers a network-free email stub adapter when the gate is on', () => {
      process.env[TEST_CHANNEL_SEEDING_ENV] = 'true'
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      const adapter = getChannelAdapter(TEST_SEED_PROVIDER_KEY)
      expect(adapter).toBeDefined()
      expect(adapter?.channelType).toBe('email')
      // conversationHistory must be false so the strict registry validator does
      // not require a fetchHistory() implementation on the stub.
      expect(adapter?.capabilities.conversationHistory).toBe(false)
      expect(getSystemEmailProviderConfigResolver(TEST_SEED_PROVIDER_KEY)?.isConfigured()).toBe(true)
    })

    it('is idempotent — repeated calls do not throw a duplicate registration', () => {
      process.env[TEST_CHANNEL_SEEDING_ENV] = '1'
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      expect(() => ensureTestSeedAdapterRegistered()).not.toThrow()
      expect(hasChannelAdapter(TEST_SEED_PROVIDER_KEY)).toBe(true)
    })

    it('the stub sendMessage reports success without network I/O', async () => {
      process.env[TEST_CHANNEL_SEEDING_ENV] = 'on'
      clearChannelAdapters()
      ensureTestSeedAdapterRegistered()
      const adapter = getChannelAdapter(TEST_SEED_PROVIDER_KEY)
      expect(adapter).toBeDefined()
      const result = await adapter!.sendMessage({
        conversationId: 'conv-1',
        content: { text: 'hi', bodyFormat: 'text' },
        credentials: {},
        scope: { tenantId: 't', organizationId: 'o' },
      })
      expect(result.status).toBe('sent')
      expect(typeof result.externalMessageId).toBe('string')
      expect(result.externalMessageId.length).toBeGreaterThan(0)
    })
  })

  describe('isTestEmailCaptureAccessAuthorized', () => {
    it('requires the exact configured opaque access token', () => {
      process.env[TEST_EMAIL_CAPTURE_ACCESS_TOKEN_ENV] = 'a'.repeat(64)

      expect(isTestEmailCaptureAccessAuthorized('a'.repeat(64))).toBe(true)
      expect(isTestEmailCaptureAccessAuthorized('b'.repeat(64))).toBe(false)
      expect(isTestEmailCaptureAccessAuthorized(null)).toBe(false)
    })

    it('fails closed for missing or short configured tokens', () => {
      delete process.env[TEST_EMAIL_CAPTURE_ACCESS_TOKEN_ENV]
      expect(isTestEmailCaptureAccessAuthorized('a'.repeat(64))).toBe(false)

      process.env[TEST_EMAIL_CAPTURE_ACCESS_TOKEN_ENV] = 'too-short'
      expect(isTestEmailCaptureAccessAuthorized('too-short')).toBe(false)
    })
  })
})

const tenantId = 'tenant-1'
const organizationId = 'organization-1'
const captureScope = { tenantId, organizationId }

function makeCapturedMessage(
  scope: TestSeedCapturedMessage['scope'],
  to: string,
  subject: string,
): TestSeedCapturedMessage {
  return {
    capturedAt: new Date().toISOString(),
    externalMessageId: `${subject}@test-seed.local`,
    content: { text: subject, bodyFormat: 'text' },
    scope,
    metadata: { to, subject },
  }
}

describe('test-seed email capture scoping', () => {
  const originalCapturePath = process.env.OM_TEST_SYSTEM_EMAIL_CAPTURE_PATH
  const originalCorrelationToken = process.env[TEST_EMAIL_CAPTURE_CORRELATION_TOKEN_ENV]
  let capturePath: string
  const correlationToken = 'c'.repeat(64)

  beforeEach(() => {
    capturePath = path.join(tmpdir(), `open-mercato-test-email-${Date.now()}-${Math.random()}.jsonl`)
    process.env.OM_TEST_SYSTEM_EMAIL_CAPTURE_PATH = capturePath
    process.env[TEST_EMAIL_CAPTURE_CORRELATION_TOKEN_ENV] = correlationToken
  })

  afterEach(async () => {
    await rm(capturePath, { force: true })
    if (originalCapturePath === undefined) {
      delete process.env.OM_TEST_SYSTEM_EMAIL_CAPTURE_PATH
    } else {
      process.env.OM_TEST_SYSTEM_EMAIL_CAPTURE_PATH = originalCapturePath
    }
    if (originalCorrelationToken === undefined) {
      delete process.env[TEST_EMAIL_CAPTURE_CORRELATION_TOKEN_ENV]
    } else {
      process.env[TEST_EMAIL_CAPTURE_CORRELATION_TOKEN_ENV] = originalCorrelationToken
    }
  })

  async function seedCapture(messages: TestSeedCapturedMessage[]): Promise<void> {
    await writeFile(capturePath, `${messages.map((message) => JSON.stringify(message)).join('\n')}\n`, 'utf8')
  }

  it('returns exact-organization and tenant-wide messages without exposing another organization', async () => {
    await seedCapture([
      makeCapturedMessage(captureScope, 'exact@example.test', 'exact'),
      makeCapturedMessage({ tenantId, organizationId: tenantId }, 'tenant@example.test', 'tenant-wide'),
      makeCapturedMessage({ tenantId, organizationId: 'organization-2' }, 'other@example.test', 'other-org'),
      makeCapturedMessage({ tenantId: 'tenant-2', organizationId }, 'tenant-2@example.test', 'other-tenant'),
    ])

    const messages = await listTestSeedCapturedMessages(captureScope)

    expect(messages.map((message) => message.metadata?.subject)).toEqual(['exact', 'tenant-wide'])
  })

  it('skips foreign and malformed records instead of failing the whole capture read', async () => {
    // The unscoped `shared/lib/email/send` capture writes records with no `scope`, and the repo
    // ships a committed fixture of them. Reading one of those must not take down every capture
    // call — that turned the whole email integration suite red once already.
    const foreignRecord = { to: 'foreign@example.test', subject: 'foreign', from: 'ops@example.test' }
    await writeFile(
      capturePath,
      `${JSON.stringify(foreignRecord)}\nnot-json\n${JSON.stringify(makeCapturedMessage(captureScope, 'ours@example.test', 'ours'))}\n`,
      'utf8',
    )

    await expect(listTestSeedCapturedMessages(captureScope)).resolves.toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ subject: 'ours' }) }),
    ])
    await expect(clearTestSeedCapturedMessages(captureScope)).resolves.toBeUndefined()
  })

  it('returns system messages only for the explicitly requested recipient', async () => {
    await seedCapture([
      { ...makeCapturedMessage({ tenantId: 'system', organizationId: 'system' }, 'target@example.test', 'target'), captureCorrelationToken: correlationToken },
      { ...makeCapturedMessage({ tenantId: 'system', organizationId: 'system' }, 'other@example.test', 'other'), captureCorrelationToken: 'd'.repeat(64) },
    ])

    await expect(listTestSeedCapturedMessages(captureScope)).resolves.toEqual([])

    const messages = await listTestSeedCapturedMessages(captureScope, {
      systemRecipient: 'TARGET@example.test',
      captureCorrelationToken: correlationToken,
    })

    expect(messages.map((message) => message.metadata?.subject)).toEqual(['target'])
  })

  it('clears only visible tenant and recipient-filtered system messages', async () => {
    await seedCapture([
      makeCapturedMessage(captureScope, 'exact@example.test', 'exact'),
      makeCapturedMessage({ tenantId, organizationId: tenantId }, 'tenant@example.test', 'tenant-wide'),
      makeCapturedMessage({ tenantId, organizationId: 'organization-2' }, 'other@example.test', 'other-org'),
      { ...makeCapturedMessage({ tenantId: 'system', organizationId: 'system' }, 'target@example.test', 'target'), captureCorrelationToken: correlationToken },
      { ...makeCapturedMessage({ tenantId: 'system', organizationId: 'system' }, 'other-system@example.test', 'other-system'), captureCorrelationToken: correlationToken },
    ])

    await clearTestSeedCapturedMessages(captureScope, {
      systemRecipient: 'target@example.test',
      captureCorrelationToken: correlationToken,
    })

    await expect(listTestSeedCapturedMessages(
      { tenantId, organizationId: 'organization-2' },
      {
        systemRecipient: 'other-system@example.test',
        captureCorrelationToken: correlationToken,
      },
    )).resolves.toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ subject: 'other-org' }) }),
      expect.objectContaining({ metadata: expect.objectContaining({ subject: 'other-system' }) }),
    ])
  })

  it('never authorizes system capture access by recipient alone', async () => {
    await seedCapture([
      {
        ...makeCapturedMessage(
          { tenantId: 'system', organizationId: 'system' },
          'target@example.test',
          'target',
        ),
        captureCorrelationToken: correlationToken,
      },
    ])

    await expect(listTestSeedCapturedMessages(captureScope, {
      systemRecipient: 'target@example.test',
    })).resolves.toEqual([])
    await expect(listTestSeedCapturedMessages(captureScope, {
      systemRecipient: 'target@example.test',
      captureCorrelationToken: 'd'.repeat(64),
    })).resolves.toEqual([])
  })
})
