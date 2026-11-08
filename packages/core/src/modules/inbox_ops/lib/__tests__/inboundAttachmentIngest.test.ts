/** @jest-environment node */

import type { CreateScopedAttachmentInput } from '@open-mercato/core/modules/attachments'
import { FakeInboxDb, ORG_ID, TENANT_ID, UPDATED_AT, type Row } from './support/fakeInboxDb'
import {
  claimInboundAttachmentIngest,
  handleAbandonedInboundAttachmentIngestJob,
  InboundAttachmentIngestRetryError,
  INBOX_OPS_ATTACHMENT_FINALIZE_AFTER_MS,
  runInboundAttachmentIngest,
  type InboundAttachmentIngestDeps,
} from '../inboundAttachmentIngest'
import {
  reenqueueInboundAttachmentIngest,
  resetInboundAttachmentGateWarningsForTests,
} from '../inboundAttachments'
import { runInboundAttachmentMaintenance } from '../inboundAttachmentMaintenance'
import { releaseInboundEmailAttachments, softDeleteInboxEmailForRelease } from '../inboundAttachmentRelease'
import { INBOUND_ATTACHMENTS_CONFIG_DEFAULTS, type InboundAttachmentsConfig } from '../inboundAttachmentsConfig'
import type { ResendInboundAttachmentsApi } from '../resendInboundAttachments'
import { InboxEmailAttachment } from '../../data/entities'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => require('./support/fakeInboxDb').fakeDecryption.findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => require('./support/fakeInboxDb').fakeDecryption.findOneWithDecryption(...args),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

const MINUTE = 60 * 1000
const START = new Date('2026-11-08T10:00:00.000Z')

const config: InboundAttachmentsConfig = {
  ...INBOUND_ATTACHMENTS_CONFIG_DEFAULTS,
  maxFileBytes: 25 * 1024 * 1024,
}

type FetchBehavior = (url: string) => Promise<Response> | Response

type Harness = {
  db: FakeInboxDb
  email: Row
  clock: { now: Date }
  queue: { enqueue: jest.Mock }
  emitReceived: jest.Mock
  api: { list: jest.Mock; get: jest.Mock }
  fetchImpl: jest.Mock
  createScoped: jest.Mock
  deps: InboundAttachmentIngestDeps
  run: (attemptNumber?: number, generation?: number) => ReturnType<typeof runInboundAttachmentIngest>
}

function descriptor(id: string, clock: { now: Date }, version = 1) {
  return {
    id,
    download_url: `https://files.example.test/${id}?v=${version}`,
    expires_at: new Date(clock.now.getTime() + 60 * MINUTE).toISOString(),
  }
}

function okResponse(): Response {
  return new Response(Buffer.from('pdf'), { status: 200 })
}

function createHarness(options: {
  email?: Partial<Row>
  parts?: Array<{ id: string; values?: Partial<Row> }>
  listed?: string[] | 'not_found'
  fetch?: FetchBehavior
  config?: Partial<InboundAttachmentsConfig>
  readers?: string[]
  attachmentService?: boolean
} = {}): Harness {
  const db = new FakeInboxDb()
  const clock = { now: new Date(START) }
  const email = db.addEmail({ attachmentsNextRunAt: new Date(START), ...options.email })
  for (const part of options.parts ?? [{ id: 'a' }, { id: 'b' }]) db.addPart(email.id, part.id, part.values)
  const queue = { enqueue: jest.fn(async () => 'job-id') }
  const emitReceived = jest.fn(async () => undefined)
  const listedIds = options.listed ?? (options.parts ?? [{ id: 'a' }, { id: 'b' }]).map((part) => part.id)
  const versions = new Map<string, number>()
  const api = {
    list: jest.fn(async () => (listedIds === 'not_found'
      ? { data: null, error: { statusCode: 404, name: 'not_found', message: 'Email not found' } }
      : { data: { has_more: false, data: listedIds.map((id) => descriptor(id, clock)) }, error: null })),
    get: jest.fn(async ({ id }: { id: string }) => {
      const version = (versions.get(id) ?? 1) + 1
      versions.set(id, version)
      return { data: descriptor(id, clock, version), error: null }
    }),
  }
  const fetchImpl = jest.fn(async (url: string) => (options.fetch ? options.fetch(url) : okResponse()))
  let stored = 0
  const createScoped = jest.fn(async (input: CreateScopedAttachmentInput) => {
    stored += 1
    const attachmentId = `00000000-0000-4000-8000-00000000000${stored}`
    await input.persistLink?.(db.entityManager(), attachmentId, { content: input.textExtraction === 'none' ? null : 'extracted text' })
    return { id: attachmentId, mimeType: 'application/pdf', fileSize: input.buffer.length }
  })
  let tokens = 0
  const deps: InboundAttachmentIngestDeps = {
    em: db.entityManager(),
    attachmentService: options.attachmentService === false ? null : { createScoped: createScoped as never },
    encryptionService: { encryptEntityPayload: async (_entityId, payload) => payload },
    createResendApi: () => api as unknown as ResendInboundAttachmentsApi,
    fetchImpl: fetchImpl as never,
    emitReceived,
    queue,
    config: { ...config, ...options.config },
    listUnguardedReaders: () => options.readers ?? [],
    now: () => new Date(clock.now),
    newClaimToken: () => `token-${(tokens += 1)}`,
  }
  return {
    db,
    email,
    clock,
    queue,
    emitReceived,
    api,
    fetchImpl,
    createScoped,
    deps,
    run: (attemptNumber = 1, generation = 1) => runInboundAttachmentIngest(
      { emailId: email.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation },
      { attemptNumber },
      deps,
    ),
  }
}

function statuses(harness: Harness): Array<[unknown, unknown, unknown]> {
  return harness.db.partsOf(harness.email.id).map((row) => [row.partKey, row.status, row.reason])
}

function reportedCodes(): unknown[] {
  return mockReportError.mock.calls.map((call) => (call[1] as { code?: string }).code)
}

beforeEach(() => {
  mockReportError.mockReset()
  resetInboundAttachmentGateWarningsForTests()
})

describe('ingest: acquisition', () => {
  it('downloads every part with a fresh URL, mirrors attachment ids, emits the webhook payload once and completes', async () => {
    const harness = createHarness({ listed: ['a'] })
    const result = await harness.run()

    expect(result).toEqual({ outcome: 'completed', storedCount: 2 })
    expect(harness.api.list).toHaveBeenCalledWith({ emailId: 'resend-email-1', limit: 100 })
    expect(harness.api.get).toHaveBeenCalledTimes(1)
    expect(harness.api.get).toHaveBeenCalledWith({ emailId: 'resend-email-1', id: 'b' })
    expect(harness.fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      'https://files.example.test/a?v=1',
      'https://files.example.test/b?v=2',
    ])
    expect(harness.emitReceived).toHaveBeenCalledTimes(1)
    expect(harness.emitReceived).toHaveBeenCalledWith(
      { emailId: harness.email.id, tenantId: TENANT_ID, organizationId: ORG_ID, forwardedByAddress: 'sender@example.test', subject: 'Offer', attachmentCount: 2 },
      { persistent: true, tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(statuses(harness)).toEqual([['resend:a', 'stored', null], ['resend:b', 'stored', null]])
    const parts = harness.db.partsOf(harness.email.id)
    expect(parts.map((row) => [row.mimeType, row.sizeBytes, row.inFlightAt, row.extractedText])).toEqual([
      ['application/pdf', 3, null, 'extracted text'],
      ['application/pdf', 3, null, 'extracted text'],
    ])
    const email = harness.db.email(harness.email.id)
    expect(email).toMatchObject({ attachmentsStatus: 'completed', attachmentsClaimToken: null, attachmentsFirstFailureAt: null })
    expect(email.attachmentIds).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'])
    expect(email.updatedAt).toBe(UPDATED_AT)
  })

  it('emits only after the attachment ids are mirrored and completes only after the emit', async () => {
    const harness = createHarness()
    harness.emitReceived.mockImplementation(async () => {
      const email = harness.db.email(harness.email.id)
      expect(email.attachmentIds).toHaveLength(2)
      expect(email.attachmentsStatus).toBe('processing')
    })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed' })
  })

  it('takes a fresh URL from get when the listed one is about to expire', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }] })
    harness.api.list.mockResolvedValueOnce({
      data: { has_more: false, data: [{ ...descriptor('a', harness.clock), expires_at: new Date(START.getTime() + 10_000).toISOString() }] },
      error: null,
    })
    await harness.run()
    expect(harness.api.get).toHaveBeenCalledTimes(1)
    expect(harness.fetchImpl).toHaveBeenCalledWith('https://files.example.test/a?v=2', expect.anything())
  })

  it('refreshes the URL once after a 403 from the download URL itself', async () => {
    let calls = 0
    const harness = createHarness({
      parts: [{ id: 'a' }],
      fetch: () => (calls++ === 0 ? new Response('expired', { status: 403 }) : okResponse()),
    })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 1 })
    expect(harness.api.get).toHaveBeenCalledTimes(1)
    expect(harness.fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('pages the list with the after cursor until has_more is false', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }, { id: 'b' }] })
    harness.api.list
      .mockResolvedValueOnce({ data: { has_more: true, data: [descriptor('a', harness.clock)] }, error: null })
      .mockResolvedValueOnce({ data: { has_more: false, data: [descriptor('b', harness.clock)] }, error: null })
    await harness.run()
    expect(harness.api.list.mock.calls.map((call) => call[0])).toEqual([
      { emailId: 'resend-email-1', limit: 100 },
      { emailId: 'resend-email-1', limit: 100, after: 'a' },
    ])
    expect(harness.api.get).not.toHaveBeenCalled()
  })

  it('falls back to get per part when the list call fails', async () => {
    const harness = createHarness()
    harness.api.list.mockResolvedValueOnce({ data: null, error: { statusCode: 500, name: 'internal_server_error', message: 'boom' } })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 2 })
    expect(harness.api.get).toHaveBeenCalledTimes(2)
  })
})

describe('ingest: SDK error classification', () => {
  it('fails only the part the provider answers 404 for, and reports it', async () => {
    const harness = createHarness({ listed: ['a'] })
    harness.api.get.mockResolvedValueOnce({ data: null, error: { statusCode: 404, name: 'not_found', message: 'gone' } })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 1 })
    expect(statuses(harness)).toEqual([['resend:a', 'stored', null], ['resend:b', 'failed', 'fetch_failed']])
    expect(reportedCodes()).toEqual(['inbox_ops.attachment_fetch_failed'])
  })

  it('fails every pending part when the email is gone at the provider', async () => {
    const harness = createHarness({ listed: 'not_found' })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 0 })
    expect(statuses(harness)).toEqual([['resend:a', 'failed', 'fetch_failed'], ['resend:b', 'failed', 'fetch_failed']])
    expect(harness.fetchImpl).not.toHaveBeenCalled()
    expect(harness.emitReceived).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a rotated key (401)', { statusCode: 401, name: 'invalid_api_key' }],
    ['a restricted key (403)', { statusCode: 403, name: 'restricted_api_key' }],
    ['rate limiting (429)', { statusCode: 429, name: 'rate_limit_exceeded' }],
    ['a provider error (503)', { statusCode: 503, name: 'application_error' }],
    ['a network error (statusCode null)', { statusCode: null, name: 'application_error' }],
  ])('treats %s as transient and retries the email', async (_label, error) => {
    const harness = createHarness({ listed: ['a'] })
    harness.api.get.mockResolvedValue({ data: null, error: { ...error, message: 'x' } })
    await expect(harness.run()).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    expect(statuses(harness)).toEqual([['resend:a', 'stored', null], ['resend:b', 'pending', null]])
    expect(harness.db.partsOf(harness.email.id)[1]).toMatchObject({ inFlightAt: null, attempts: 0 })
    expect(harness.db.email(harness.email.id)).toMatchObject({
      attachmentsStatus: 'pending',
      attachmentsClaimToken: null,
      attachmentsNextRunAt: START,
      attachmentsFirstFailureAt: START,
    })
    expect(harness.emitReceived).not.toHaveBeenCalled()
  })

  it('times out a hanging download, and that part never blocks the others', async () => {
    const harness = createHarness({
      parts: [{ id: 'slow' }, { id: 'b' }, { id: 'c' }],
      config: { fetchTimeoutMs: 30 },
      fetch: (url) => (url.includes('/slow')
        ? new Promise<Response>((_, reject) => { setTimeout(() => reject(new Error('aborted')), 1000) })
        : okResponse()),
    })
    harness.fetchImpl.mockImplementation(async (url: string, init?: RequestInit) => {
      if (!url.includes('/slow')) return okResponse()
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    })
    await expect(harness.run()).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    expect(statuses(harness)).toEqual([['resend:slow', 'pending', null], ['resend:b', 'stored', null], ['resend:c', 'stored', null]])
  })

  it('times out a hanging SDK call', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }], listed: [], config: { fetchTimeoutMs: 30 } })
    harness.api.get.mockImplementation(() => new Promise(() => undefined))
    await expect(harness.run()).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    expect(statuses(harness)).toEqual([['resend:a', 'pending', null]])
  })

  it('skips a download larger than the per-file limit', async () => {
    const harness = createHarness({ parts: [{ id: 'big' }], config: { maxFileBytes: 2 } })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 0 })
    expect(statuses(harness)).toEqual([['resend:big', 'skipped', 'too_large']])
    expect(harness.createScoped).not.toHaveBeenCalled()
  })
})

describe('ingest: retry, re-enqueue and finalization', () => {
  function failingB(harness: Harness) {
    harness.fetchImpl.mockImplementation(async (url: string) => (url.includes('/b') ? new Response('down', { status: 503 }) : okResponse()))
  }

  it('re-enqueues itself with the retry delay on the last queue attempt instead of rethrowing', async () => {
    const harness = createHarness()
    failingB(harness)
    await expect(harness.run(3)).resolves.toEqual({ outcome: 'retry_requeued' })
    expect(harness.queue.enqueue).toHaveBeenCalledWith(
      { emailId: harness.email.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 2 },
      { delayMs: config.retryDelayMs },
    )
    expect(harness.db.email(harness.email.id)).toMatchObject({
      attachmentsStatus: 'pending',
      attachmentsCurrentGeneration: 2,
      attachmentsNextRunAt: new Date(START.getTime() + config.retryDelayMs),
    })
  })

  it('leaves a stranded pending email with the clock started when the replacement enqueue fails, reporting requeue_failed', async () => {
    const harness = createHarness()
    failingB(harness)
    const failure = new Error('redis down')
    harness.queue.enqueue.mockRejectedValue(failure)
    await expect(harness.run(3)).rejects.toBe(failure)
    expect(harness.db.email(harness.email.id)).toMatchObject({
      attachmentsStatus: 'pending',
      attachmentsClaimToken: null,
      attachmentsFirstFailureAt: START,
      attachmentsCurrentGeneration: 1,
    })
    expect(reportedCodes()).toEqual(['inbox_ops.attachment_requeue_failed'])
  })

  it('re-run after a stranded email is re-enqueued finishes it', async () => {
    const harness = createHarness()
    failingB(harness)
    harness.queue.enqueue.mockRejectedValueOnce(new Error('redis down'))
    await expect(harness.run(3)).rejects.toThrow('redis down')
    const requeued = await reenqueueInboundAttachmentIngest({ em: harness.deps.em, email: { id: harness.email.id, tenantId: TENANT_ID, organizationId: ORG_ID }, queue: harness.queue })
    expect(requeued).toMatchObject({ kind: 'enqueued', generation: 3, confirmed: true })
    harness.fetchImpl.mockImplementation(async () => okResponse())
    await expect(harness.run(1, 3)).resolves.toMatchObject({ outcome: 'completed', storedCount: 2 })
  })

  it('finalizes in the worker 6 hours after the first failure, once every remaining part was attempted', async () => {
    const harness = createHarness({
      email: { attachmentsFirstFailureAt: new Date(START.getTime() - INBOX_OPS_ATTACHMENT_FINALIZE_AFTER_MS - MINUTE) },
      parts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    })
    failingB(harness)
    await expect(harness.run()).resolves.toEqual({ outcome: 'finalized', storedCount: 2 })
    expect(harness.fetchImpl).toHaveBeenCalledTimes(3)
    expect(statuses(harness)).toEqual([['resend:a', 'stored', null], ['resend:b', 'failed', 'ingest_timeout'], ['resend:c', 'stored', null]])
    expect(harness.emitReceived).toHaveBeenCalledTimes(1)
    expect(harness.db.email(harness.email.id).attachmentsStatus).toBe('completed')
    expect(reportedCodes()).toEqual(['inbox_ops.attachment_ingest_timeout'])
  })

  it('skips finalization when a manual retry reset the clock during the run', async () => {
    const harness = createHarness({
      email: { attachmentsFirstFailureAt: new Date(START.getTime() - INBOX_OPS_ATTACHMENT_FINALIZE_AFTER_MS - MINUTE) },
    })
    harness.fetchImpl.mockImplementation(async (url: string) => {
      if (!url.includes('/b')) return okResponse()
      harness.db.email(harness.email.id).attachmentsFirstFailureAt = null
      return new Response('down', { status: 503 })
    })
    await expect(harness.run()).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    expect(statuses(harness)).toEqual([['resend:a', 'stored', null], ['resend:b', 'pending', null]])
    expect(harness.db.email(harness.email.id)).toMatchObject({ attachmentsStatus: 'pending', attachmentsFirstFailureAt: START })
    expect(harness.emitReceived).not.toHaveBeenCalled()
  })

  it('does not finalize before 6 hours have passed', async () => {
    const harness = createHarness({ email: { attachmentsFirstFailureAt: new Date(START.getTime() - 5 * 60 * MINUTE) } })
    failingB(harness)
    await expect(harness.run()).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    expect(statuses(harness)[1]).toEqual(['resend:b', 'pending', null])
  })

  it('retries a failed emit with no part pending without starting the clock and never finalizes it', async () => {
    const harness = createHarness({
      parts: [{ id: 'a', values: { status: 'stored', attachmentId: '00000000-0000-4000-8000-0000000000aa' } }],
      email: { attachmentsFirstFailureAt: null },
    })
    harness.emitReceived.mockRejectedValue(new Error('bus down'))
    await expect(harness.run()).rejects.toMatchObject({ reason: 'emit_failed' })
    expect(harness.db.email(harness.email.id)).toMatchObject({ attachmentsStatus: 'pending', attachmentsFirstFailureAt: null, attachmentsClaimToken: null })

    const old = createHarness({
      parts: [{ id: 'a', values: { status: 'stored', attachmentId: '00000000-0000-4000-8000-0000000000aa' } }],
      email: { attachmentsFirstFailureAt: new Date(START.getTime() - 2 * INBOX_OPS_ATTACHMENT_FINALIZE_AFTER_MS) },
    })
    old.emitReceived.mockRejectedValue(new Error('bus down'))
    await expect(old.run(3)).resolves.toEqual({ outcome: 'retry_requeued' })
    expect(old.db.email(old.email.id).attachmentsStatus).toBe('pending')
    expect(reportedCodes()).not.toContain('inbox_ops.attachment_ingest_timeout')
  })

  it('treats a missing event bus as a failed emit', async () => {
    const harness = createHarness({ parts: [] })
    harness.deps.emitReceived = undefined
    await expect(harness.run()).rejects.toMatchObject({ reason: 'emit_failed' })
    expect(harness.db.email(harness.email.id).attachmentsStatus).toBe('pending')
  })
})

describe('ingest: poison parts', () => {
  it('counts a crash during the download and stores the part without text on its last allowed attempt', async () => {
    const harness = createHarness({
      parts: [
        { id: 'crashed-once', values: { inFlightAt: new Date(START.getTime() - MINUTE), attempts: 0 } },
        { id: 'crashed-twice', values: { inFlightAt: new Date(START.getTime() - MINUTE), attempts: 1 } },
      ],
    })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 2 })
    expect(harness.createScoped.mock.calls.map((call) => (call[0] as CreateScopedAttachmentInput).textExtraction)).toEqual(['return', 'none'])
    const parts = harness.db.partsOf(harness.email.id)
    expect(parts.map((row) => [row.attempts, row.inFlightAt, row.extractedText])).toEqual([
      [1, null, 'extracted text'],
      [2, null, null],
    ])
  })

  it('marks a part beyond the limit processing_failed without fetching it', async () => {
    const harness = createHarness({
      parts: [{ id: 'poison', values: { inFlightAt: new Date(START.getTime() - MINUTE), attempts: 2 } }, { id: 'b' }],
    })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 1 })
    expect(statuses(harness)).toEqual([['resend:poison', 'failed', 'processing_failed'], ['resend:b', 'stored', null]])
    expect(harness.db.partsOf(harness.email.id)[0]).toMatchObject({ attempts: 3, inFlightAt: null })
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1)
    expect(reportedCodes()).toEqual(['inbox_ops.attachment_store_failed'])
  })

  it('does not count transient download failures as crashes', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }] })
    harness.fetchImpl.mockResolvedValue(new Response('down', { status: 503 }))
    await expect(harness.run()).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    expect(harness.db.partsOf(harness.email.id)[0]).toMatchObject({ attempts: 0, inFlightAt: null })
  })

  it('sets in_flight_at before the first provider call for the part', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }], listed: [] })
    harness.api.get.mockImplementation(async ({ id }: { id: string }) => {
      expect(harness.db.partsOf(harness.email.id)[0].inFlightAt).toEqual(START)
      return { data: descriptor(id, harness.clock), error: null }
    })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed' })
  })
})

describe('ingest: unexpected errors', () => {
  function failNextPartClear(harness: Harness, error: Error): void {
    const em = harness.deps.em as unknown as { nativeUpdate: (entity: unknown, where: unknown, data: Record<string, unknown>) => Promise<number> }
    const original = em.nativeUpdate
    let failed = false
    em.nativeUpdate = async (entity, where, data) => {
      if (!failed && entity === InboxEmailAttachment && data.inFlightAt === null && !('status' in data)) {
        failed = true
        throw error
      }
      return original(entity, where, data)
    }
  }

  it('releases the lease and clears in_flight_at of the current part only, then rethrows', async () => {
    const staleInFlight = new Date(START.getTime() - MINUTE)
    const harness = createHarness({ parts: [{ id: 'a' }, { id: 'b', values: { inFlightAt: staleInFlight, attempts: 1 } }] })
    harness.fetchImpl.mockResolvedValue(new Response('down', { status: 503 }))
    const blip = new Error('connection reset')
    failNextPartClear(harness, blip)

    await expect(harness.run()).rejects.toBe(blip)

    expect(harness.db.email(harness.email.id)).toMatchObject({
      attachmentsStatus: 'pending',
      attachmentsClaimToken: null,
      attachmentsNextRunAt: START,
    })
    const [first, second] = harness.db.partsOf(harness.email.id)
    expect(first).toMatchObject({ status: 'pending', inFlightAt: null, attempts: 0 })
    // A crash recorded by an earlier run is still charged.
    expect(second).toMatchObject({ status: 'pending', inFlightAt: staleInFlight, attempts: 1 })
  })

  it('re-enqueues itself with the retry delay after releasing the claim on the last queue attempt', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }] })
    harness.fetchImpl.mockResolvedValue(new Response('down', { status: 503 }))
    failNextPartClear(harness, new Error('connection reset'))

    await expect(harness.run(3)).resolves.toEqual({ outcome: 'error_requeued' })

    expect(reportedCodes()).toEqual(['inbox_ops.attachment_ingest_failed'])
    expect(harness.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ generation: 2 }), { delayMs: config.retryDelayMs })
    expect(harness.db.email(harness.email.id)).toMatchObject({ attachmentsStatus: 'pending', attachmentsClaimToken: null })
  })

  it('does not charge the error as a crash on the next run', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }] })
    harness.fetchImpl.mockResolvedValueOnce(new Response('down', { status: 503 }))
    failNextPartClear(harness, new Error('connection reset'))
    await expect(harness.run()).rejects.toThrow('connection reset')

    await expect(harness.run(1, 1)).resolves.toMatchObject({ outcome: 'completed', storedCount: 1 })
    expect(harness.db.partsOf(harness.email.id)[0]).toMatchObject({ status: 'stored', attempts: 0, inFlightAt: null })
    expect(harness.createScoped.mock.calls.map((call) => (call[0] as CreateScopedAttachmentInput).textExtraction)).toEqual(['return'])
  })

  it('reports the error as inbox_ops.attachment_ingest_failed and starts the 6-hour clock once', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }] })
    harness.fetchImpl.mockResolvedValue(new Response('down', { status: 503 }))
    failNextPartClear(harness, new Error('connection reset'))
    await expect(harness.run()).rejects.toThrow('connection reset')

    expect(reportedCodes()).toEqual(['inbox_ops.attachment_ingest_failed'])
    expect(mockReportError.mock.calls[0][1]).toMatchObject({
      attributes: { emailId: harness.email.id, tenantId: TENANT_ID, generation: 1 },
    })
    expect(harness.db.email(harness.email.id).attachmentsFirstFailureAt).toEqual(START)

    harness.clock.now = new Date(START.getTime() + 60 * MINUTE)
    failNextPartClear(harness, new Error('connection reset'))
    await expect(harness.run(2)).rejects.toThrow('connection reset')
    expect(harness.db.email(harness.email.id).attachmentsFirstFailureAt).toEqual(START)
  })

  it('finalizes a persistent fault only at the end of a run that attempted every remaining part', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }, { id: 'b' }] })
    harness.fetchImpl.mockResolvedValue(new Response('down', { status: 503 }))
    failNextPartClear(harness, new Error('connection reset'))
    await expect(harness.run()).rejects.toThrow('connection reset')
    expect(harness.db.email(harness.email.id).attachmentsFirstFailureAt).toEqual(START)

    // Past the 6 hours, a run that fails again before reaching part b finalizes nothing.
    harness.clock.now = new Date(START.getTime() + INBOX_OPS_ATTACHMENT_FINALIZE_AFTER_MS + MINUTE)
    failNextPartClear(harness, new Error('connection reset'))
    await expect(harness.run(2)).rejects.toThrow('connection reset')
    expect(statuses(harness)).toEqual([['resend:a', 'pending', null], ['resend:b', 'pending', null]])
    expect(harness.db.email(harness.email.id)).toMatchObject({ attachmentsStatus: 'pending' })

    // The next run attempts both parts; they fail transiently, so the clock started by the fault finalizes them.
    await expect(harness.run(3)).resolves.toEqual({ outcome: 'finalized', storedCount: 0 })
    expect(statuses(harness)).toEqual([['resend:a', 'failed', 'ingest_timeout'], ['resend:b', 'failed', 'ingest_timeout']])
    expect(harness.db.email(harness.email.id)).toMatchObject({ attachmentsStatus: 'completed' })
  })

  it('leaves a claim another run took over untouched', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }] })
    harness.fetchImpl.mockResolvedValue(new Response('down', { status: 503 }))
    const em = harness.deps.em as unknown as { nativeUpdate: (entity: unknown, where: unknown, data: Record<string, unknown>) => Promise<number> }
    const original = em.nativeUpdate
    const blip = new Error('connection reset')
    em.nativeUpdate = async (entity, where, data) => {
      // The renewal before the part's resolution write: another run took the claim, then the database fails.
      if (harness.fetchImpl.mock.calls.length > 0 && entity !== InboxEmailAttachment && 'attachmentsClaimedAt' in data && em.nativeUpdate !== original) {
        harness.db.applyCommitted('email', harness.email.id, { attachmentsClaimToken: 'someone-else' })
        em.nativeUpdate = original
        throw blip
      }
      return original(entity, where, data)
    }
    await expect(harness.run()).rejects.toBe(blip)
    expect(harness.db.email(harness.email.id)).toMatchObject({ attachmentsStatus: 'processing', attachmentsClaimToken: 'someone-else' })
    expect(harness.db.partsOf(harness.email.id)[0].inFlightAt).toEqual(START)
  })

  it('reports a failed emit and an unavailable Resend client', async () => {
    const emit = createHarness({ parts: [] })
    emit.emitReceived.mockRejectedValue(new Error('bus down'))
    await expect(emit.run()).rejects.toMatchObject({ reason: 'emit_failed' })
    expect(reportedCodes()).toContain('inbox_ops.attachment_emit_failed')

    mockReportError.mockClear()
    const provider = createHarness({ parts: [{ id: 'a' }] })
    provider.deps.createResendApi = () => { throw new Error('RESEND_API_KEY is required') }
    await expect(provider.run()).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    expect(reportedCodes()).toEqual(['inbox_ops.attachment_provider_unavailable'])
  })
})

describe('ingest: upload outcomes', () => {
  it('keeps the email when the quota is exceeded and reports the part', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }] })
    const { CrudHttpError } = jest.requireActual('@open-mercato/shared/lib/crud/errors')
    harness.createScoped.mockRejectedValue(new CrudHttpError(413, { error: 'quota', code: 'quota_exceeded' }))
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 0 })
    expect(statuses(harness)).toEqual([['resend:a', 'failed', 'quota_exceeded']])
    expect(reportedCodes()).toEqual(['inbox_ops.attachment_store_failed'])
    expect(harness.emitReceived).toHaveBeenCalledWith(expect.objectContaining({ attachmentCount: 0 }), expect.anything())
  })

  it('retries a transient upload failure (storage_failed)', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }] })
    const { CrudHttpError } = jest.requireActual('@open-mercato/shared/lib/crud/errors')
    harness.createScoped.mockRejectedValue(new CrudHttpError(500, { error: 'storage', code: 'storage_failed' }))
    await expect(harness.run()).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    expect(statuses(harness)).toEqual([['resend:a', 'pending', null]])
  })

  it('completes pending parts as store_failed when the attachment service is absent', async () => {
    const harness = createHarness({ attachmentService: false })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 0 })
    expect(statuses(harness)).toEqual([['resend:a', 'failed', 'store_failed'], ['resend:b', 'failed', 'store_failed']])
    expect(harness.api.list).not.toHaveBeenCalled()
  })
})

describe('ingest: gate', () => {
  it('skips every pending part as unguarded_reader without provider calls and completes the email', async () => {
    const harness = createHarness({ readers: ['agent_orchestrator'] })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 0 })
    expect(statuses(harness)).toEqual([['resend:a', 'skipped', 'unguarded_reader'], ['resend:b', 'skipped', 'unguarded_reader']])
    expect(harness.api.list).not.toHaveBeenCalled()
    expect(harness.emitReceived).toHaveBeenCalledTimes(1)
  })

  it('a gate that closes during an ingest marks the remaining parts on the next run', async () => {
    const harness = createHarness()
    let readers: string[] = []
    harness.deps.listUnguardedReaders = () => readers
    harness.fetchImpl.mockImplementation(async (url: string) => (url.includes('/b') ? new Response('down', { status: 503 }) : okResponse()))
    await expect(harness.run()).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    readers = ['agent_orchestrator']
    await expect(harness.run(2)).resolves.toMatchObject({ outcome: 'completed', storedCount: 1 })
    expect(statuses(harness)).toEqual([['resend:a', 'stored', null], ['resend:b', 'skipped', 'unguarded_reader']])
  })

  it('still finishes an already pending email after the kill switch is turned off', async () => {
    const harness = createHarness({ config: { enabled: false } })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed', storedCount: 2 })
  })
})

describe('ingest: claims', () => {
  it('ends without writes or provider calls when the job is superseded', async () => {
    const harness = createHarness({ email: { attachmentsIngestGeneration: 3, attachmentsCurrentGeneration: 3 } })
    const updates = jest.fn()
    harness.db.beforeUpdate = updates
    await expect(harness.run(1, 2)).resolves.toEqual({ outcome: 'superseded' })
    expect(updates).not.toHaveBeenCalled()
    expect(harness.api.list).not.toHaveBeenCalled()
  })

  it('cannot claim when it is superseded between its read and its claim', async () => {
    const harness = createHarness()
    let bumped = false
    harness.db.beforeUpdate = (entity) => {
      if (entity === 'email' && !bumped) {
        bumped = true
        harness.db.email(harness.email.id).attachmentsCurrentGeneration = 2
      }
    }
    await expect(harness.run()).resolves.toEqual({ outcome: 'superseded' })
    expect(harness.db.email(harness.email.id).attachmentsStatus).toBe('pending')
    expect(harness.api.list).not.toHaveBeenCalled()
  })

  it('re-enqueues itself after the remaining lease when another claim is live', async () => {
    const harness = createHarness({
      email: { attachmentsStatus: 'processing', attachmentsClaimToken: 'other', attachmentsClaimedAt: new Date(START.getTime() - 10 * MINUTE) },
    })
    await expect(harness.run()).resolves.toEqual({ outcome: 'lease_live_requeued' })
    expect(harness.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ generation: 2 }), { delayMs: 20 * MINUTE })
    expect(harness.db.email(harness.email.id).attachmentsClaimToken).toBe('other')
  })

  it('re-enqueues at once when the holder released the email between the lost claim and the reload', async () => {
    const harness = createHarness({
      email: { attachmentsStatus: 'processing', attachmentsClaimToken: 'other', attachmentsClaimedAt: new Date(START.getTime() - 10 * MINUTE) },
    })
    const em = harness.deps.em as unknown as { nativeUpdate: (entity: unknown, where: unknown, data: Record<string, unknown>) => Promise<number> }
    const original = em.nativeUpdate
    em.nativeUpdate = async (entity, where, data) => {
      const updated = await original(entity, where, data)
      if (updated === 0 && data.attachmentsClaimToken === 'token-1') {
        Object.assign(harness.db.email(harness.email.id), { attachmentsStatus: 'pending', attachmentsClaimToken: null, attachmentsClaimedAt: null })
      }
      return updated
    }
    await expect(harness.run()).resolves.toEqual({ outcome: 'released_requeued' })
    expect(harness.queue.enqueue).toHaveBeenCalledTimes(1)
    expect(harness.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ generation: 2 }))
  })

  it('takes over an expired lease and starts the 6-hour clock', async () => {
    const harness = createHarness({
      email: { attachmentsStatus: 'processing', attachmentsClaimToken: 'crashed', attachmentsClaimedAt: new Date(START.getTime() - 31 * MINUTE) },
    })
    await expect(harness.run()).resolves.toMatchObject({ outcome: 'completed' })
    expect(harness.db.email(harness.email.id).attachmentsFirstFailureAt).toEqual(START)
  })

  it('lets only one of two claims win', async () => {
    const harness = createHarness()
    const ref = { id: harness.email.id, tenantId: TENANT_ID, organizationId: ORG_ID }
    const first = await claimInboundAttachmentIngest(harness.deps.em, ref, { generation: 1, token: 'one', now: START, leaseMs: config.leaseMs })
    const second = await claimInboundAttachmentIngest(harness.deps.em, ref, { generation: 1, token: 'two', now: START, leaseMs: config.leaseMs })
    expect([first, second]).toEqual([true, false])
    expect(harness.db.email(harness.email.id).attachmentsClaimToken).toBe('one')
  })

  it('renews the claim after every part, so a run longer than the lease of slow failing parts is not taken over', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
    const renewals: Date[] = []
    harness.fetchImpl.mockImplementation(async () => {
      harness.clock.now = new Date(harness.clock.now.getTime() + 20 * MINUTE)
      const takeover = await claimInboundAttachmentIngest(harness.deps.em, { id: harness.email.id, tenantId: TENANT_ID, organizationId: ORG_ID }, {
        generation: 1,
        token: 'intruder',
        now: harness.clock.now,
        leaseMs: config.leaseMs,
      })
      expect(takeover).toBe(false)
      renewals.push(harness.db.email(harness.email.id).attachmentsClaimedAt as Date)
      return new Response('slow failure', { status: 503 })
    })
    await expect(harness.run()).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    expect(renewals).toHaveLength(3)
    expect(renewals[1].getTime() - renewals[0].getTime()).toBe(20 * MINUTE)
  })

  it('aborts without emitting when persistLink loses the claim', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }] })
    harness.createScoped.mockImplementation(async (input: CreateScopedAttachmentInput) => {
      harness.db.email(harness.email.id).attachmentsClaimToken = 'someone-else'
      await input.persistLink?.(harness.deps.em, '00000000-0000-4000-8000-0000000000ff', { content: 'x' })
      return { id: 'never', mimeType: 'application/pdf', fileSize: 3 }
    })
    await expect(harness.run()).resolves.toEqual({ outcome: 'claim_lost' })
    expect(statuses(harness)).toEqual([['resend:a', 'pending', null]])
    expect(harness.emitReceived).not.toHaveBeenCalled()
  })
})

describe('ingest: deletion', () => {
  it('stores no further part and emits nothing when the email is deleted during an in-flight ingest; release clears the stored part', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
    harness.fetchImpl.mockImplementation(async (url: string) => {
      if (url.includes('/b')) await softDeleteInboxEmailForRelease(harness.deps.em, { id: harness.email.id, tenantId: TENANT_ID, organizationId: ORG_ID })
      return okResponse()
    })
    await expect(harness.run()).resolves.toEqual({ outcome: 'claim_lost' })
    expect(statuses(harness)).toEqual([['resend:a', 'stored', null], ['resend:b', 'pending', null], ['resend:c', 'pending', null]])
    expect(harness.fetchImpl).toHaveBeenCalledTimes(2)
    expect(harness.emitReceived).not.toHaveBeenCalled()
    expect(harness.db.email(harness.email.id)).toMatchObject({ attachmentsStatus: 'completed', attachmentsClaimToken: null })

    const releaseScoped = jest.fn(async () => undefined)
    const releaseOwnedScoped = jest.fn(async () => ({ deleted: 0, repointed: 0, detached: 0 }))
    const released = await releaseInboundEmailAttachments({
      em: harness.deps.em,
      email: { id: harness.email.id, tenantId: TENANT_ID, organizationId: ORG_ID },
      attachmentService: { releaseScoped, releaseOwnedScoped },
      now: () => START,
    })
    expect(released).toMatchObject({ fullyReleased: true, markedReleased: true })
    expect(releaseScoped).toHaveBeenCalledWith({
      attachmentId: '00000000-0000-4000-8000-000000000001',
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      expectedOwner: { entityId: 'inbox_ops:inbox_email', recordId: harness.email.id },
      expectedAssignment: { type: 'inbox_ops:inbox_email', id: harness.email.id },
    })
    expect(harness.db.partsOf(harness.email.id).map((row) => [row.status, row.fileName, row.extractedText])).toEqual([
      ['released', null, null],
      ['released', null, null],
      ['released', null, null],
    ])
  })

  it('completes a soft-deleted email without an emit', async () => {
    const harness = createHarness({ email: { deletedAt: new Date(START), attachmentsClaimToken: null } })
    await expect(harness.run()).resolves.toEqual({ outcome: 'deleted' })
    expect(harness.db.email(harness.email.id)).toMatchObject({ attachmentsStatus: 'completed', attachmentsClaimToken: null })
    expect(harness.emitReceived).not.toHaveBeenCalled()
  })

  it('ends for a missing email, an email without attachment ingest, and a completed email', async () => {
    const missing = createHarness()
    missing.db.emails.clear()
    await expect(missing.run()).resolves.toEqual({ outcome: 'missing' })
    const plain = createHarness({ email: { attachmentsStatus: null } })
    await expect(plain.run()).resolves.toEqual({ outcome: 'missing' })
    const completed = createHarness({ email: { attachmentsStatus: 'completed' } })
    await expect(completed.run()).resolves.toEqual({ outcome: 'already_completed' })
    expect(completed.emitReceived).not.toHaveBeenCalled()
  })
})

describe('abandoned jobs', () => {
  function envelope(emailId: string, generation: number) {
    return { id: 'queued-1', payload: { emailId, tenantId: TENANT_ID, organizationId: ORG_ID, generation }, createdAt: START.toISOString() }
  }

  it('re-enqueues a current abandoned job and starts the 6-hour clock', async () => {
    const harness = createHarness()
    await handleAbandonedInboundAttachmentIngestJob(envelope(harness.email.id, 1), { jobId: 'bull-1', reason: 'stalled' }, {
      em: harness.deps.em,
      queue: harness.queue,
      now: () => START,
    })
    expect(harness.queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ generation: 2 }))
    expect(harness.db.email(harness.email.id)).toMatchObject({ attachmentsFirstFailureAt: START, attachmentsCurrentGeneration: 2 })
  })

  it('ignores a stale report: no re-enqueue, no clock', async () => {
    const harness = createHarness({ email: { attachmentsIngestGeneration: 2, attachmentsCurrentGeneration: 2 } })
    await handleAbandonedInboundAttachmentIngestJob(envelope(harness.email.id, 1), { jobId: 'bull-1', reason: 'stalled' }, {
      em: harness.deps.em,
      queue: harness.queue,
    })
    expect(harness.queue.enqueue).not.toHaveBeenCalled()
    expect(harness.db.email(harness.email.id)).toMatchObject({ attachmentsFirstFailureAt: null, attachmentsIngestGeneration: 2 })
  })

  it('reports and rethrows when the re-enqueue fails, so the report stays unacknowledged', async () => {
    const harness = createHarness()
    harness.queue.enqueue.mockRejectedValue(new Error('redis down'))
    await expect(handleAbandonedInboundAttachmentIngestJob(envelope(harness.email.id, 1), { jobId: null, reason: 'stalled' }, {
      em: harness.deps.em,
      queue: harness.queue,
    })).rejects.toThrow('redis down')
    expect(reportedCodes()).toEqual(['inbox_ops.attachment_requeue_failed'])
    expect(harness.db.email(harness.email.id).attachmentsCurrentGeneration).toBe(1)
  })

  it('tolerates an envelope it does not recognise', async () => {
    const harness = createHarness()
    await handleAbandonedInboundAttachmentIngestJob({ payload: { runId: 'x' } }, { jobId: null, reason: 'stalled' }, { em: harness.deps.em, queue: harness.queue })
    await handleAbandonedInboundAttachmentIngestJob(null, { jobId: null, reason: 'stalled' }, { em: harness.deps.em, queue: harness.queue })
    expect(harness.queue.enqueue).not.toHaveBeenCalled()
  })
})

describe('single job chain', () => {
  it('keeps exactly one current job through an outage, sweeps, a duplicate re-enqueue, a manual retry and a re-delivered abandonment report', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }] })
    harness.fetchImpl.mockResolvedValue(new Response('down', { status: 503 }))
    const ref = { id: harness.email.id, tenantId: TENANT_ID, organizationId: ORG_ID }
    const sweep = () => runInboundAttachmentMaintenance({ em: harness.deps.em, queue: harness.queue, config, now: () => new Date(harness.clock.now), listUnguardedReaders: () => [] })

    await expect(harness.run(1)).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    await expect(harness.run(2)).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    await expect(harness.run(3)).resolves.toEqual({ outcome: 'retry_requeued' })
    expect(harness.db.email(ref.id).attachmentsCurrentGeneration).toBe(2)

    harness.clock.now = new Date(START.getTime() + 5 * MINUTE)
    expect((await sweep()).reenqueued).toBe(0)
    harness.clock.now = new Date(START.getTime() + 29 * MINUTE)
    expect((await sweep()).reenqueued).toBe(0)
    harness.clock.now = new Date(START.getTime() + 31 * MINUTE)
    expect((await sweep()).reenqueued).toBe(1)
    expect((await sweep()).reenqueued).toBe(0)

    expect(await reenqueueInboundAttachmentIngest({ em: harness.deps.em, email: ref, queue: harness.queue })).toMatchObject({ kind: 'enqueued', generation: 4 })
    expect(await reenqueueInboundAttachmentIngest({ em: harness.deps.em, email: ref, queue: harness.queue })).toMatchObject({ kind: 'enqueued', generation: 5 })
    await handleAbandonedInboundAttachmentIngestJob(
      { payload: { ...ref, emailId: ref.id, generation: 3 } },
      { jobId: null, reason: 'stalled' },
      { em: harness.deps.em, queue: harness.queue },
    )

    const providerCalls = harness.api.list.mock.calls.length
    for (const generation of [2, 3, 4]) {
      for (const attempt of [1, 2, 3]) {
        await expect(harness.run(attempt, generation)).resolves.toEqual({ outcome: 'superseded' })
      }
    }
    expect(harness.api.list.mock.calls.length).toBe(providerCalls)
    expect(harness.queue.enqueue.mock.calls.map((call) => (call[0] as { generation: number }).generation)).toEqual([2, 3, 4, 5])
    expect(harness.db.email(ref.id)).toMatchObject({ attachmentsCurrentGeneration: 5, attachmentsIngestGeneration: 5 })

    harness.fetchImpl.mockImplementation(async () => okResponse())
    await expect(harness.run(1, 5)).resolves.toMatchObject({ outcome: 'completed', storedCount: 1 })
    expect(await reenqueueInboundAttachmentIngest({ em: harness.deps.em, email: ref, queue: harness.queue })).toEqual({ kind: 'not_reserved' })
  })

  it('lets a claim holder superseded while running finish its run; its queue retries then end as superseded', async () => {
    const harness = createHarness({ parts: [{ id: 'a' }, { id: 'b' }] })
    const ref = { id: harness.email.id, tenantId: TENANT_ID, organizationId: ORG_ID }
    harness.fetchImpl.mockImplementation(async (url: string) => {
      if (url.includes('/a')) await reenqueueInboundAttachmentIngest({ em: harness.deps.em, email: ref, queue: harness.queue })
      return url.includes('/b') ? new Response('down', { status: 503 }) : okResponse()
    })
    await expect(harness.run(1)).rejects.toBeInstanceOf(InboundAttachmentIngestRetryError)
    expect(statuses(harness)[0]).toEqual(['resend:a', 'stored', null])
    await expect(harness.run(2)).resolves.toEqual({ outcome: 'superseded' })
    await expect(harness.run(3)).resolves.toEqual({ outcome: 'superseded' })
    expect(harness.queue.enqueue).toHaveBeenCalledTimes(1)
  })
})
