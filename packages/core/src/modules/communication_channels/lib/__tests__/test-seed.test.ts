import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  TEST_CHANNEL_SEEDING_ENV,
  TEST_SEED_PROVIDER_KEY,
  clearTestSeedCapturedMessages,
  ensureTestSeedAdapterRegistered,
  isTestChannelSeedingEnabled,
  listTestSeedCapturedMessages,
  type TestSeedCapturedMessage,
} from '../test-seed'
import { clearChannelAdapters, hasChannelAdapter, getChannelAdapter } from '../registry'

describe('communication_channels test-seed gate', () => {
  const originalFlag = process.env[TEST_CHANNEL_SEEDING_ENV]

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[TEST_CHANNEL_SEEDING_ENV]
    else process.env[TEST_CHANNEL_SEEDING_ENV] = originalFlag
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
  const originalCapturePath = process.env.OM_TEST_EMAIL_CAPTURE_PATH
  let capturePath: string

  beforeEach(() => {
    capturePath = path.join(tmpdir(), `open-mercato-test-email-${Date.now()}-${Math.random()}.jsonl`)
    process.env.OM_TEST_EMAIL_CAPTURE_PATH = capturePath
  })

  afterEach(async () => {
    await rm(capturePath, { force: true })
    if (originalCapturePath === undefined) {
      delete process.env.OM_TEST_EMAIL_CAPTURE_PATH
    } else {
      process.env.OM_TEST_EMAIL_CAPTURE_PATH = originalCapturePath
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

  it('returns system messages only for the explicitly requested recipient', async () => {
    await seedCapture([
      makeCapturedMessage({ tenantId: 'system', organizationId: 'system' }, 'target@example.test', 'target'),
      makeCapturedMessage({ tenantId: 'system', organizationId: 'system' }, 'other@example.test', 'other'),
    ])

    await expect(listTestSeedCapturedMessages(captureScope)).resolves.toEqual([])

    const messages = await listTestSeedCapturedMessages(captureScope, {
      systemRecipient: 'TARGET@example.test',
    })

    expect(messages.map((message) => message.metadata?.subject)).toEqual(['target'])
  })

  it('clears only visible tenant and recipient-filtered system messages', async () => {
    await seedCapture([
      makeCapturedMessage(captureScope, 'exact@example.test', 'exact'),
      makeCapturedMessage({ tenantId, organizationId: tenantId }, 'tenant@example.test', 'tenant-wide'),
      makeCapturedMessage({ tenantId, organizationId: 'organization-2' }, 'other@example.test', 'other-org'),
      makeCapturedMessage({ tenantId: 'system', organizationId: 'system' }, 'target@example.test', 'target'),
      makeCapturedMessage({ tenantId: 'system', organizationId: 'system' }, 'other-system@example.test', 'other-system'),
    ])

    await clearTestSeedCapturedMessages(captureScope, { systemRecipient: 'target@example.test' })

    await expect(listTestSeedCapturedMessages(
      { tenantId, organizationId: 'organization-2' },
      { systemRecipient: 'other-system@example.test' },
    )).resolves.toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ subject: 'other-org' }) }),
      expect.objectContaining({ metadata: expect.objectContaining({ subject: 'other-system' }) }),
    ])
  })
})
