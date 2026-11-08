/** @jest-environment node */

import { Webhook } from 'svix'
import { InboxEmail, InboxEmailAttachment, InboxSettings } from '../../../data/entities'
import { parseInboundEmail } from '../../../lib/emailParser'
import { runInboundAttachmentIngest } from '../../../lib/inboundAttachmentIngest'
import { resetInboundAttachmentConfigReportsForTests, resetInboundAttachmentGateWarningsForTests } from '../../../lib/inboundAttachments'
import { resetInboundAttachmentCatchUpForTests } from '../../../lib/inboundAttachmentWebhook'
import { INBOUND_ATTACHMENTS_CONFIG_DEFAULTS } from '../../../lib/inboundAttachmentsConfig'
import type { ResendInboundAttachmentsApi } from '../../../lib/resendInboundAttachments'
import { FakeInboxDb, ORG_ID, TENANT_ID, type Row } from '../../../lib/__tests__/support/fakeInboxDb'

const mockReceivingGet = jest.fn()
const mockEnqueue = jest.fn()
const mockEmit = jest.fn()
const mockReportError = jest.fn()
const mockEnsureSchedule = jest.fn()
const mockReaders = jest.fn((): string[] => [])
const mockWarn = jest.fn()
const mockLoggerError = jest.fn()
const mockState: { db: FakeInboxDb | null; attachmentService: boolean } = { db: null, attachmentService: true }

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = {
    warn: (...args: unknown[]) => mockWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  }
  return { createLogger: () => logger }
})
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => require('../../../lib/__tests__/support/fakeInboxDb').fakeDecryption.findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => require('../../../lib/__tests__/support/fakeInboxDb').fakeDecryption.findOneWithDecryption(...args),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string): unknown => {
      if (token === 'em') return mockState.db?.entityManager()
      if (token === 'attachmentService') return mockState.attachmentService ? { createScoped: jest.fn() } : null
      return null
    },
  })),
}))
jest.mock('@open-mercato/queue', () => ({
  ...jest.requireActual('@open-mercato/queue'),
  createModuleQueue: () => ({ enqueue: (...args: unknown[]) => mockEnqueue(...args) }),
}))
jest.mock('@open-mercato/core/modules/attachments', () => ({
  listUnguardedAttachmentReaders: () => mockReaders(),
}))
jest.mock('../../../lib/resendClient', () => ({
  createInboundResendClient: () => ({ emails: { receiving: { get: (...args: unknown[]) => mockReceivingGet(...args) } } }),
}))
jest.mock('../../../lib/rateLimiter', () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
}))
jest.mock('../../../lib/inboundAttachmentSchedule', () => ({
  ensureInboundAttachmentMaintenanceScheduleLazily: (...args: unknown[]) => mockEnsureSchedule(...args),
}))
jest.mock('../../../events', () => ({
  emitInboxOpsEvent: (...args: unknown[]) => mockEmit(...args),
}))

import { POST } from '../inbound'

const SIGNING_SECRET = `whsec_${Buffer.from('inbox-ops-attachment-webhook-test-secret').toString('base64')}`
const INBOX = 'ops@inbox.example.test'
const OTHER_TENANT_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_ORG_ID = '44444444-4444-4444-8444-444444444444'
const OTHER_INBOX = 'other@inbox.example.test'
const MINUTE = 60 * 1000
const MIB = 1024 * 1024
const ENV_KEYS = [
  'RESEND_WEBHOOK_SIGNING_SECRET',
  'INBOX_OPS_WEBHOOK_SECRET',
  'INBOX_OPS_ATTACHMENTS_ENABLED',
  'INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS',
  'OM_ENABLE_RESEND_STUB',
  'INBOX_OPS_ATTACHMENT_LEASE_MS',
  'INBOX_OPS_MAX_ATTACHMENTS',
  'RESEND_API_KEY',
] as const

type MetadataPart = {
  id: string
  filename: string | null
  size: number
  content_type: string
  content_id: string | null
  content_disposition: string | null
}

type ResendEmail = {
  id: string
  to: string[]
  from: string
  subject: string
  text: string | null
  html: string | null
  message_id: string
  reply_to: string[] | null
  headers: Record<string, string> | null
  attachments: MetadataPart[]
}

function pdf(id: string, size = 1000): MetadataPart {
  return { id, filename: `${id}.pdf`, size, content_type: 'application/pdf', content_id: null, content_disposition: 'attachment' }
}

function logo(id: string): MetadataPart {
  return { id, filename: 'logo.png', size: 2000, content_type: 'image/png', content_id: `<${id}@mail>`, content_disposition: 'inline' }
}

function resendEmail(values: Partial<ResendEmail> = {}): ResendEmail {
  return {
    id: 'resend-email-1',
    to: [INBOX],
    from: 'Supplier <supplier@example.test>',
    subject: 'Offer',
    text: '',
    html: null,
    message_id: '<offer-1@example.test>',
    reply_to: null,
    headers: null,
    attachments: [],
    ...values,
  }
}

function resendRequest(email: ResendEmail): Request {
  mockReceivingGet.mockImplementation(async (id: string) => (id === email.id
    ? { data: email, error: null }
    : { data: null, error: { name: 'not_found', message: 'Email not found' } }))
  const body = JSON.stringify({ type: 'email.received', data: { email_id: email.id, to: email.to } })
  const messageId = `msg_${email.id}_${Math.random().toString(36).slice(2)}`
  const timestamp = new Date()
  const signature = new Webhook(SIGNING_SECRET).sign(messageId, timestamp, body)
  return new Request('http://localhost/api/inbox_ops/webhook/inbound', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'svix-id': messageId,
      'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
      'svix-signature': signature,
    },
    body,
  })
}

function parserInput(email: ResendEmail) {
  return { from: email.from, to: email.to, subject: email.subject, text: email.text ?? undefined, messageId: email.message_id }
}

function createDb(): FakeInboxDb {
  const db = new FakeInboxDb()
  for (const [tenantId, organizationId, inboxAddress] of [[TENANT_ID, ORG_ID, INBOX], [OTHER_TENANT_ID, OTHER_ORG_ID, OTHER_INBOX]]) {
    db.table(InboxSettings).set(`settings-${tenantId}`, {
      id: `settings-${tenantId}`,
      inboxAddress,
      isActive: true,
      deletedAt: null,
      webhookSecret: null,
      tenantId,
      organizationId,
    })
  }
  mockState.db = db
  return db
}

function emailsOf(db: FakeInboxDb, tenantId = TENANT_ID): Row[] {
  return [...db.emails.values()].filter((row) => row.tenantId === tenantId)
}

function ledgerOf(db: FakeInboxDb, emailId: string): Array<[unknown, unknown, unknown, unknown]> {
  return db.partsOf(emailId).map((row) => [row.partKey, row.fileName, row.status, row.reason])
}

function emittedEvents(): unknown[] {
  return mockEmit.mock.calls.map((call) => call[0])
}

function enqueuedJobs(): unknown[] {
  return mockEnqueue.mock.calls.map((call) => call[0])
}

function reportedCodes(): unknown[] {
  return mockReportError.mock.calls.map((call) => (call[1] as { code?: string }).code)
}

function warningMessages(): string[] {
  return mockWarn.mock.calls.map((call) => String(call[0]))
}

let db: FakeInboxDb

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  process.env.RESEND_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET
  jest.clearAllMocks()
  mockReaders.mockReturnValue([])
  mockEnqueue.mockImplementation(async () => 'job-id')
  mockEmit.mockResolvedValue(undefined)
  mockEnsureSchedule.mockResolvedValue('scheduler_unavailable')
  mockState.attachmentService = true
  resetInboundAttachmentGateWarningsForTests()
  resetInboundAttachmentConfigReportsForTests()
  resetInboundAttachmentCatchUpForTests()
  db = createDb()
})

afterEach(() => {
  jest.useRealTimers()
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('Resend email with attachments, ingestion enabled', () => {
  it('persists a pending email and its ledger rows in one transaction, enqueues generation 1 and does not emit', async () => {
    const email = resendEmail({
      attachments: [logo('logo'), pdf('offer'), { ...pdf('blank'), filename: null }, pdf('huge', 30 * MIB)],
    })

    const response = await POST(resendRequest(email))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    const [stored] = emailsOf(db)
    expect(stored).toMatchObject({
      status: 'received',
      attachmentsStatus: 'pending',
      metadata: { attachmentIngest: { provider: 'resend', providerEmailId: 'resend-email-1' } },
      attachmentsIngestGeneration: 1,
      attachmentsCurrentGeneration: 1,
      contentHash: parseInboundEmail(parserInput(email), { attachmentIds: ['offer', 'blank', 'huge'] }).contentHash,
    })
    expect(stored.attachmentsNextRunAt).toBeInstanceOf(Date)
    expect(ledgerOf(db, stored.id)).toEqual([
      ['resend:logo', 'logo.png', 'skipped', 'inline_decoration'],
      ['resend:offer', 'offer.pdf', 'pending', null],
      ['resend:blank', 'attachment-3.pdf', 'pending', null],
      ['resend:huge', 'huge.pdf', 'skipped', 'too_large'],
    ])
    expect(db.flushes).toEqual([{ emails: 1, parts: 4 }])
    expect(enqueuedJobs()).toEqual([{ emailId: stored.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 1 }])
    expect(mockEmit).not.toHaveBeenCalled()
    expect(mockEnsureSchedule).toHaveBeenCalledTimes(1)
  })

  it('completes and emits at once, without an ingest job, when the webhook skips every part, even while the queue is down', async () => {
    mockEnqueue.mockRejectedValue(new Error('[internal] queue down'))
    const email = resendEmail({ attachments: [logo('logo'), pdf('huge', 30 * MIB)] })

    const response = await POST(resendRequest(email))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    const [stored] = emailsOf(db)
    expect(stored).toMatchObject({
      status: 'received',
      attachmentsStatus: 'completed',
      attachmentsCurrentGeneration: 0,
      contentHash: parseInboundEmail(parserInput(email), { attachmentIds: ['huge'] }).contentHash,
    })
    expect(ledgerOf(db, stored.id)).toEqual([
      ['resend:logo', 'logo.png', 'skipped', 'inline_decoration'],
      ['resend:huge', 'huge.pdf', 'skipped', 'too_large'],
    ])
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEnsureSchedule).not.toHaveBeenCalled()
    expect(mockEmit).toHaveBeenCalledWith(
      'inbox_ops.email.received',
      { emailId: stored.id, tenantId: TENANT_ID, organizationId: ORG_ID, forwardedByAddress: 'supplier@example.test', subject: 'Offer' },
      { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(reportedCodes()).not.toContain('inbox_ops.attachment_requeue_failed')
  })

  it('records metadata entries with a valid id but a malformed size, and hashes them', async () => {
    const malformed = (id: string) => ({ id, filename: `${id}.pdf`, size: 'big', content_type: 'application/pdf', content_id: null, content_disposition: 'attachment' }) as unknown as MetadataPart
    const email = resendEmail({ attachments: [malformed('odd'), pdf('offer'), malformed('odd-2'), { filename: 'no-id.pdf' } as unknown as MetadataPart] })

    expect((await POST(resendRequest(email))).status).toBe(200)

    const [stored] = emailsOf(db)
    expect(stored).toMatchObject({
      attachmentsStatus: 'pending',
      contentHash: parseInboundEmail(parserInput(email), { attachmentIds: ['odd', 'offer', 'odd-2'] }).contentHash,
    })
    // An unknown size reserves the per-file maximum (25 MiB) against the 25 MiB total, after the parts of known size.
    expect(ledgerOf(db, stored.id)).toEqual([
      ['resend:odd', 'odd.pdf', 'skipped', 'total_too_large'],
      ['resend:offer', 'offer.pdf', 'pending', null],
      ['resend:odd-2', 'odd-2.pdf', 'skipped', 'total_too_large'],
    ])
    expect(db.partsOf(stored.id).map((row) => row.sizeBytes)).toEqual([null, 1000, null])

    const alone = resendEmail({ id: 'resend-email-2', message_id: '<offer-2@example.test>', attachments: [malformed('solo')] })
    expect((await POST(resendRequest(alone))).status).toBe(200)
    const solo = emailsOf(db).find((row) => row.id !== stored.id) as Row
    expect(ledgerOf(db, solo.id)).toEqual([['resend:solo', 'solo.pdf', 'pending', null]])
    expect(enqueuedJobs()).toHaveLength(2)
  })

  it('creates the ledger rows through the ORM inside the email transaction, so a failed insert writes neither', async () => {
    const createSpy = jest.spyOn(db, 'create')
    db.beforeFlush = () => {
      throw new Error('[internal] connection lost')
    }

    await expect(POST(resendRequest(resendEmail({ attachments: [pdf('offer')] })))).rejects.toThrow('connection lost')

    expect(createSpy.mock.calls.map((call) => call[0])).toEqual([InboxEmail, InboxEmailAttachment])
    expect(createSpy.mock.calls[1][1]).toMatchObject({ fileName: 'offer.pdf', partKey: 'resend:offer', status: 'pending' })
    expect(db.emails.size).toBe(0)
    expect(db.parts.size).toBe(0)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('answers 500 without emitting when the enqueue fails, and the redelivery re-enqueues the pending email', async () => {
    const email = resendEmail({ attachments: [pdf('offer')] })
    mockEnqueue.mockRejectedValueOnce(new Error('[internal] queue down'))

    const failed = await POST(resendRequest(email))

    expect(failed.status).toBe(500)
    const [stored] = emailsOf(db)
    expect(stored).toMatchObject({ attachmentsStatus: 'pending', attachmentsCurrentGeneration: 1 })
    expect(mockEmit).not.toHaveBeenCalled()
    expect(reportedCodes()).toContain('inbox_ops.attachment_requeue_failed')

    const redelivered = await POST(resendRequest(email))

    expect(redelivered.status).toBe(200)
    expect(emailsOf(db)).toHaveLength(1)
    expect(enqueuedJobs().at(-1)).toEqual({ emailId: stored.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 2 })
    expect(db.email(stored.id)).toMatchObject({ attachmentsIngestGeneration: 2, attachmentsCurrentGeneration: 2 })
    expect(emittedEvents()).toEqual(['inbox_ops.email.deduplicated'])
  })

  it('persists and ingests a second attachment-only email with the same sender, subject and metadata but new ids', async () => {
    const first = resendEmail({ attachments: [pdf('order-a')] })
    const second = resendEmail({ id: 'resend-email-2', message_id: '<offer-2@example.test>', attachments: [pdf('order-b')] })

    expect((await POST(resendRequest(first))).status).toBe(200)
    expect((await POST(resendRequest(second))).status).toBe(200)

    const stored = emailsOf(db)
    expect(stored).toHaveLength(2)
    expect(new Set(stored.map((row) => row.contentHash)).size).toBe(2)
    expect(stored.map((row) => row.attachmentsStatus)).toEqual(['pending', 'pending'])
    expect(enqueuedJobs()).toHaveLength(2)
    expect(emittedEvents()).toEqual([])
  })

  it('completes the email with failed rows when the provider fetch never succeeds', async () => {
    expect((await POST(resendRequest(resendEmail({ attachments: [pdf('offer'), pdf('terms')] })))).status).toBe(200)
    const [stored] = emailsOf(db)
    const emitReceived = jest.fn(async () => undefined)
    const notFound = { data: null, error: { statusCode: 404, name: 'not_found', message: 'Email not found' } }
    const api = { list: jest.fn(async () => notFound), get: jest.fn(async () => notFound) }

    const result = await runInboundAttachmentIngest(
      { emailId: stored.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 1 },
      { attemptNumber: 1 },
      {
        em: db.entityManager(),
        attachmentService: { createScoped: jest.fn() },
        encryptionService: { encryptEntityPayload: async (_entityId, payload) => payload },
        createResendApi: () => api as unknown as ResendInboundAttachmentsApi,
        fetchImpl: jest.fn() as never,
        emitReceived,
        queue: { enqueue: jest.fn(async () => 'job') },
        config: { ...INBOUND_ATTACHMENTS_CONFIG_DEFAULTS, maxFileBytes: 25 * MIB },
        listUnguardedReaders: () => [],
      },
    )

    expect(result).toMatchObject({ outcome: 'completed', storedCount: 0 })
    expect(ledgerOf(db, stored.id).map((row) => [row[2], row[3]])).toEqual([['failed', 'fetch_failed'], ['failed', 'fetch_failed']])
    expect(db.email(stored.id).attachmentsStatus).toBe('completed')
    expect(emitReceived).toHaveBeenCalledWith(
      { emailId: stored.id, tenantId: TENANT_ID, organizationId: ORG_ID, forwardedByAddress: 'supplier@example.test', subject: 'Offer', attachmentCount: 0 },
      { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })
})

describe('Resend email whose attachments are not ingested', () => {
  function expectTodaysPath(email: ResendEmail, attachmentIds: string[]): Row {
    const [stored] = emailsOf(db)
    expect(stored).toMatchObject({
      status: 'received',
      attachmentsStatus: null,
      metadata: null,
      contentHash: parseInboundEmail(parserInput(email), { attachmentIds }).contentHash,
    })
    expect(db.parts.size).toBe(0)
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEnsureSchedule).not.toHaveBeenCalled()
    expect(mockEmit).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledWith(
      'inbox_ops.email.received',
      { emailId: stored.id, tenantId: TENANT_ID, organizationId: ORG_ID, forwardedByAddress: 'supplier@example.test', subject: 'Offer' },
      { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    return stored
  }

  it('leaves mail without attachments unchanged, without reading the attachment configuration', async () => {
    process.env.INBOX_OPS_ATTACHMENT_LEASE_MS = 'not-a-number'
    const email = resendEmail({ text: 'Please quote 10 widgets.' })

    const response = await POST(resendRequest(email))

    expect(response.status).toBe(200)
    const stored = expectTodaysPath(email, [])
    expect(stored.contentHash).toBe(parseInboundEmail(parserInput(email)).contentHash)
  })

  it('still ingests mail with attachments under a malformed setting, with the default, and reports it', async () => {
    process.env.INBOX_OPS_MAX_ATTACHMENTS = 'twenty'
    const response = await POST(resendRequest(resendEmail({ attachments: [pdf('offer')] })))

    expect(response.status).toBe(200)
    expect(emailsOf(db).map((row) => row.attachmentsStatus)).toEqual(['pending'])
    expect(reportedCodes()).toContain('inbox_ops.attachment_config_invalid')
  })

  it('records at most the ledger cap and counts the omitted parts', async () => {
    const parts = [pdf('offer'), ...Array.from({ length: 105 }, (_, index) => logo(`logo-${index}`))]
    const response = await POST(resendRequest(resendEmail({ attachments: parts })))

    expect(response.status).toBe(200)
    const [stored] = emailsOf(db)
    expect(ledgerOf(db, stored.id)).toHaveLength(100)
    expect(stored.metadata).toMatchObject({ attachmentIngest: { provider: 'resend', providerEmailId: 'resend-email-1', omittedParts: 6 } })
  })

  it('leaves mail whose only parts are inline logos unchanged, hash included', async () => {
    const email = resendEmail({ text: 'Regards', attachments: [logo('logo-1'), logo('logo-2')] })

    expect((await POST(resendRequest(email))).status).toBe(200)

    const stored = expectTodaysPath(email, [])
    expect(stored.contentHash).toBe(parseInboundEmail(parserInput(email)).contentHash)
  })

  it('ignores attachments while the kill switch is off, but keeps their ids in the hash', async () => {
    process.env.INBOX_OPS_ATTACHMENTS_ENABLED = 'false'
    const email = resendEmail({ attachments: [pdf('offer'), logo('logo')] })

    expect((await POST(resendRequest(email))).status).toBe(200)

    const stored = expectTodaysPath(email, ['offer'])
    expect(stored.contentHash).not.toBe(parseInboundEmail(parserInput(email)).contentHash)
    expect(mockReaders).not.toHaveBeenCalled()
  })

  it('ignores attachments without the attachment service', async () => {
    mockState.attachmentService = false
    const email = resendEmail({ attachments: [pdf('offer')] })

    expect((await POST(resendRequest(email))).status).toBe(200)

    expectTodaysPath(email, ['offer'])
  })
})

describe('Resend email with attachments while an unguarded reader is enabled (D19)', () => {
  it('completes the email with skipped/unguarded_reader rows, enqueues nothing and emits as today', async () => {
    mockReaders.mockReturnValue(['agent_orchestrator'])
    db.addPart('earlier-email', 'stored-before', { status: 'stored' })
    const email = resendEmail({ attachments: [logo('logo'), pdf('offer'), pdf('huge', 30 * MIB)] })

    expect((await POST(resendRequest(email))).status).toBe(200)

    const [stored] = emailsOf(db)
    expect(stored).toMatchObject({ status: 'received', attachmentsStatus: 'completed', attachmentsCurrentGeneration: 0 })
    expect(ledgerOf(db, stored.id)).toEqual([
      ['resend:logo', 'logo.png', 'skipped', 'inline_decoration'],
      ['resend:offer', 'offer.pdf', 'skipped', 'unguarded_reader'],
      ['resend:huge', 'huge.pdf', 'skipped', 'unguarded_reader'],
    ])
    expect(db.flushes).toEqual([{ emails: 1, parts: 3 }])
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEnsureSchedule).not.toHaveBeenCalled()
    expect(mockEmit).toHaveBeenCalledWith(
      'inbox_ops.email.received',
      { emailId: stored.id, tenantId: TENANT_ID, organizationId: ORG_ID, forwardedByAddress: 'supplier@example.test', subject: 'Offer' },
      { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(mockWarn).toHaveBeenCalledWith(
      'Inbound email attachments are not stored while modules that read attachments without owner checks are enabled',
      { modules: ['agent_orchestrator'] },
    )
    expect(mockWarn).toHaveBeenCalledWith(
      'Stored inbound email attachments are readable through modules that read attachments without owner checks',
      { modules: ['agent_orchestrator'] },
    )
  })

  it('warns once per process naming the module, and ingests again once the module declares', async () => {
    mockReaders.mockReturnValue(['agent_orchestrator'])
    await POST(resendRequest(resendEmail({ attachments: [pdf('first')] })))
    await POST(resendRequest(resendEmail({ id: 'resend-email-2', message_id: '<offer-2@example.test>', attachments: [pdf('second')] })))

    expect(warningMessages().filter((message) => message.startsWith('Inbound email attachments are not stored'))).toHaveLength(1)

    mockReaders.mockReturnValue([])
    await POST(resendRequest(resendEmail({ id: 'resend-email-3', message_id: '<offer-3@example.test>', attachments: [pdf('third')] })))

    expect(emailsOf(db).map((row) => row.attachmentsStatus)).toEqual(['completed', 'completed', 'pending'])
    expect(enqueuedJobs()).toHaveLength(1)
  })

  it('ignores the test opt-out without OM_ENABLE_RESEND_STUB=true or with a real API key, and honors it with both flags and a stub key', async () => {
    mockReaders.mockReturnValue(['agent_orchestrator'])
    process.env.INBOX_OPS_ATTACHMENTS_ALLOW_UNGUARDED_READERS = 'true'
    process.env.RESEND_API_KEY = 're_stub_test'
    await POST(resendRequest(resendEmail({ attachments: [pdf('first')] })))

    process.env.OM_ENABLE_RESEND_STUB = 'true'
    process.env.RESEND_API_KEY = 're_live_key'
    await POST(resendRequest(resendEmail({ id: 'resend-email-2', message_id: '<offer-2@example.test>', attachments: [pdf('second')] })))

    process.env.RESEND_API_KEY = 're_stub_test'
    await POST(resendRequest(resendEmail({ id: 'resend-email-3', message_id: '<offer-3@example.test>', attachments: [pdf('third')] })))

    expect(emailsOf(db).map((row) => row.attachmentsStatus)).toEqual(['completed', 'completed', 'pending'])
  })
})

describe('duplicates', () => {
  function seedDuplicate(values: Partial<Row>): Row {
    return db.addEmail({ messageId: '<offer-1@example.test>', contentHash: 'existing-hash', ...values })
  }

  it.each([
    ['pending', { attachmentsStatus: 'pending' }],
    ['processing with an expired lease', { attachmentsStatus: 'processing', attachmentsClaimedAt: new Date(Date.now() - 31 * MINUTE) }],
  ])('re-enqueues an existing email whose ingest is %s before answering 200', async (_label, values) => {
    const existing = seedDuplicate(values)

    const response = await POST(resendRequest(resendEmail({ attachments: [pdf('offer')] })))

    expect(response.status).toBe(200)
    expect(emailsOf(db)).toHaveLength(1)
    expect(enqueuedJobs()).toEqual([{ emailId: existing.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 2 }])
    expect(emittedEvents()).toEqual(['inbox_ops.email.deduplicated'])
  })

  it.each([
    ['processing with a live lease', { attachmentsStatus: 'processing', attachmentsClaimedAt: new Date() }],
    ['completed', { attachmentsStatus: 'completed' }],
    ['without attachments', { attachmentsStatus: null }],
  ])('does not re-enqueue an existing email that is %s', async (_label, values) => {
    seedDuplicate(values)

    const response = await POST(resendRequest(resendEmail({ attachments: [pdf('offer')] })))

    expect(response.status).toBe(200)
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(emittedEvents()).toEqual(['inbox_ops.email.deduplicated'])
  })

  it('answers 500 without the deduplicated event when the duplicate re-enqueue fails', async () => {
    const existing = seedDuplicate({ attachmentsStatus: 'pending' })
    mockEnqueue.mockRejectedValueOnce(new Error('[internal] queue down'))

    const response = await POST(resendRequest(resendEmail({ attachments: [pdf('offer')] })))

    expect(response.status).toBe(500)
    expect(db.email(existing.id).attachmentsCurrentGeneration).toBe(1)
    expect(mockEmit).not.toHaveBeenCalled()
    expect(reportedCodes()).toContain('inbox_ops.attachment_requeue_failed')
  })

  it('answers a redelivery after deletion as a duplicate instead of a 500 (unique index covers soft-deleted emails)', async () => {
    seedDuplicate({ attachmentsStatus: 'completed', deletedAt: new Date() })

    const response = await POST(resendRequest(resendEmail({ attachments: [pdf('offer')] })))

    expect(response.status).toBe(200)
    expect(emailsOf(db)).toHaveLength(1)
    expect(db.parts.size).toBe(0)
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(emittedEvents()).toEqual(['inbox_ops.email.deduplicated'])
  })

  it('answers a redelivery after deletion of an email without attachments as a duplicate as well', async () => {
    seedDuplicate({ attachmentsStatus: null, deletedAt: new Date() })

    const response = await POST(resendRequest(resendEmail({ text: 'Plain text' })))

    expect(response.status).toBe(200)
    expect(emailsOf(db)).toHaveLength(1)
    expect(emittedEvents()).toEqual(['inbox_ops.email.deduplicated'])
  })

  it('applies the re-enqueue rule to the email a concurrent insert collided with', async () => {
    let racing: Row | null = null
    db.beforeFlush = () => {
      db.beforeFlush = null
      racing = seedDuplicate({ attachmentsStatus: 'pending' })
    }

    const response = await POST(resendRequest(resendEmail({ attachments: [pdf('offer')] })))

    expect(response.status).toBe(200)
    expect(emailsOf(db)).toHaveLength(1)
    expect(enqueuedJobs()).toEqual([{ emailId: racing!.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 2 }])
    expect(emittedEvents()).toEqual(['inbox_ops.email.deduplicated'])
  })

  it('still fails with 500 for errors other than a unique violation', async () => {
    db.beforeFlush = () => {
      throw new Error('[internal] connection lost')
    }
    await expect(POST(resendRequest(resendEmail({ text: 'Plain text' })))).rejects.toThrow('connection lost')
    expect(mockEmit).not.toHaveBeenCalled()
  })
})

describe('catch-up of the inbox\'s stranded emails', () => {
  const NOW = new Date('2026-11-08T10:00:00.000Z')

  function useClock(at: Date): void {
    jest.useFakeTimers({
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
    })
    jest.setSystemTime(at)
  }

  function seedStranded(count: number, values: Partial<Row> = {}): Row[] {
    return Array.from({ length: count }, (_unused, index) => db.addEmail({
      attachmentsNextRunAt: new Date(NOW.getTime() - (20 + index) * MINUTE),
      attachmentsFirstFailureAt: new Date(NOW.getTime() - 60 * MINUTE),
      ...values,
    }))
  }

  it('re-enqueues at most 10 stranded emails of the inbox after the email\'s own writes, once per scope within 5 minutes', async () => {
    useClock(NOW)
    const stranded = seedStranded(12)
    db.addEmail({ attachmentsNextRunAt: new Date(NOW.getTime() - 5 * MINUTE) })
    db.addEmail({ tenantId: OTHER_TENANT_ID, organizationId: OTHER_ORG_ID, attachmentsNextRunAt: new Date(NOW.getTime() - 60 * MINUTE) })

    const response = await POST(resendRequest(resendEmail({ text: 'Plain text' })))

    expect(response.status).toBe(200)
    expect(emittedEvents()).toEqual(['inbox_ops.email.received'])
    expect(mockEmit.mock.invocationCallOrder[0]).toBeLessThan(mockEnqueue.mock.invocationCallOrder[0])
    const requeued = enqueuedJobs() as Array<{ emailId: string; generation: number }>
    expect(requeued).toHaveLength(10)
    expect(requeued.map((job) => job.emailId)).toEqual(stranded.slice().reverse().slice(0, 10).map((row) => row.id))
    expect(requeued.every((job) => job.generation === 2)).toBe(true)

    jest.setSystemTime(new Date(NOW.getTime() + 4 * MINUTE))
    await POST(resendRequest(resendEmail({ id: 'resend-email-2', message_id: '<plain-2@example.test>', text: 'Second' })))
    expect(enqueuedJobs()).toHaveLength(10)

    await POST(resendRequest(resendEmail({ id: 'resend-email-3', to: [OTHER_INBOX], message_id: '<plain-3@example.test>', text: 'Other inbox' })))
    expect(enqueuedJobs()).toHaveLength(11)

    jest.setSystemTime(new Date(NOW.getTime() + 6 * MINUTE))
    await POST(resendRequest(resendEmail({ id: 'resend-email-4', message_id: '<plain-4@example.test>', text: 'Fourth' })))
    expect(enqueuedJobs()).toHaveLength(13)
  })

  it('also runs after a duplicate, and the re-run finishes the stranded email', async () => {
    useClock(NOW)
    const [stranded] = seedStranded(1, { metadata: { attachmentIngest: { provider: 'resend', providerEmailId: 'resend-stranded' } } })
    db.addPart(stranded.id, 'offer')
    db.addEmail({ messageId: '<offer-1@example.test>', attachmentsStatus: null })

    expect((await POST(resendRequest(resendEmail({ text: 'Plain text' })))).status).toBe(200)
    expect(enqueuedJobs()).toEqual([{ emailId: stranded.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 2 }])
    jest.useRealTimers()

    const emitReceived = jest.fn(async () => undefined)
    const descriptor = { id: 'offer', download_url: 'https://files.example.test/offer', expires_at: new Date(Date.now() + 60 * MINUTE).toISOString() }
    const createScoped = jest.fn(async (input: { persistLink?: (tx: unknown, id: string, extras: { content: string | null }) => Promise<void> }) => {
      await input.persistLink?.(db.entityManager(), '00000000-0000-4000-8000-000000000001', { content: 'text' })
      return { id: '00000000-0000-4000-8000-000000000001', mimeType: 'application/pdf', fileSize: 3 }
    })
    const result = await runInboundAttachmentIngest(
      { emailId: stranded.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 2 },
      { attemptNumber: 1 },
      {
        em: db.entityManager(),
        attachmentService: { createScoped: createScoped as never },
        encryptionService: { encryptEntityPayload: async (_entityId, payload) => payload },
        createResendApi: () => ({
          list: async () => ({ data: { has_more: false, data: [descriptor] }, error: null }),
          get: async () => ({ data: descriptor, error: null }),
        }) as unknown as ResendInboundAttachmentsApi,
        fetchImpl: (async () => new Response(Buffer.from('pdf'), { status: 200 })) as never,
        emitReceived,
        queue: { enqueue: jest.fn(async () => 'job') },
        config: { ...INBOUND_ATTACHMENTS_CONFIG_DEFAULTS, maxFileBytes: 25 * MIB },
        listUnguardedReaders: () => [],
      },
    )

    expect(result).toMatchObject({ outcome: 'completed', storedCount: 1 })
    expect(db.email(stranded.id).attachmentsStatus).toBe('completed')
    expect(emitReceived).toHaveBeenCalledTimes(1)
  })

  it('never changes the response when the catch-up fails, and reports it', async () => {
    useClock(NOW)
    const execute = db.execute.bind(db)
    jest.spyOn(db, 'execute').mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('where tenant_id = ? and organization_id = ?')) throw new Error('[internal] statement timeout')
      return execute(sql, params)
    })

    const response = await POST(resendRequest(resendEmail({ attachments: [pdf('offer')] })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(emailsOf(db)[0].attachmentsStatus).toBe('pending')
    expect(enqueuedJobs()).toHaveLength(1)
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      code: 'inbox_ops.attachment_requeue_failed',
      attributes: expect.objectContaining({ step: 'catch_up' }),
    }))
  })

  it('reports a failed catch-up re-enqueue without changing the response', async () => {
    useClock(NOW)
    const [stranded] = seedStranded(1)
    mockEnqueue.mockImplementation(async (job: { emailId: string }) => {
      if (job.emailId === stranded.id) throw new Error('[internal] queue down')
      return 'job-id'
    })

    const response = await POST(resendRequest(resendEmail({ text: 'Plain text' })))

    expect(response.status).toBe(200)
    expect(db.email(stranded.id).attachmentsCurrentGeneration).toBe(1)
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      code: 'inbox_ops.attachment_requeue_failed',
      attributes: expect.objectContaining({ emailId: stranded.id, step: 'catch_up' }),
    }))
  })
})
