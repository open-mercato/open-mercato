/** @jest-environment node */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueuedJob } from '@open-mercato/queue'

const mockRunIngest = jest.fn()
const mockRunMaintenance = jest.fn()
const mockBullAdd = jest.fn(async () => ({ id: 'bull-job-id' }))
let mockBullProcessor: ((job: { id?: string; data: unknown; attemptsMade: number }) => Promise<void>) | null = null

jest.mock('../inboundAttachmentIngest', () => ({
  ...jest.requireActual('../inboundAttachmentIngest'),
  runInboundAttachmentIngest: (...args: unknown[]) => mockRunIngest(...args),
}))
jest.mock('../inboundAttachmentMaintenance', () => ({
  ...jest.requireActual('../inboundAttachmentMaintenance'),
  runInboundAttachmentMaintenance: (...args: unknown[]) => mockRunMaintenance(...args),
}))
jest.mock('bullmq', () => {
  class MockQueue {
    add = mockBullAdd
    close = jest.fn(async () => undefined)
    getJobs = jest.fn(async () => [])
  }
  class MockWorker {
    constructor(_name: string, processor: typeof mockBullProcessor) {
      mockBullProcessor = processor
    }
    on = jest.fn()
    close = jest.fn(async () => undefined)
  }
  return { Queue: MockQueue, Worker: MockWorker }
}, { virtual: true })

import { createQueue } from '@open-mercato/queue'
import * as queueModule from '@open-mercato/queue'
import ingestWorker, { metadata as ingestMetadata } from '../../workers/attachment-ingest'
import maintenanceWorker, { metadata as maintenanceMetadata } from '../../workers/attachment-maintenance'
import {
  enqueueInboundAttachmentIngestJob,
  getInboundAttachmentIngestQueue,
  INBOX_OPS_ATTACHMENT_INGEST_CONCURRENCY,
  INBOX_OPS_ATTACHMENT_INGEST_QUEUE,
  INBOX_OPS_ATTACHMENT_INGEST_QUEUE_ATTEMPTS,
  reenqueueInboundAttachmentIngest,
  RESERVE_INBOUND_ATTACHMENT_GENERATION_SQL,
} from '../inboundAttachments'
import { INBOX_OPS_ATTACHMENT_INGEST_LOCK_DURATION_MS } from '../inboundAttachmentsConfig'
import { INBOX_OPS_ATTACHMENT_MAINTENANCE_QUEUE } from '../inboundAttachmentMaintenance'
import type { InboundAttachmentIngestJob } from '../../data/validators'

const job: InboundAttachmentIngestJob = {
  emailId: '33333333-3333-4333-8333-333333333333',
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  generation: 4,
}

function fakeEm(generation: number | null) {
  const execute = jest.fn(async () => (generation === null ? [] : [{ generation }]))
  const nativeUpdate = jest.fn(async () => 1)
  const em = { getConnection: () => ({ execute }), nativeUpdate, fork: () => em }
  return { em: em as unknown as EntityManager, execute, nativeUpdate }
}

function workerContext(resolve: Record<string, unknown>, attemptNumber = 1) {
  return {
    jobId: 'job-1',
    attemptNumber,
    queueName: INBOX_OPS_ATTACHMENT_INGEST_QUEUE,
    resolve: <T,>(name: string): T => {
      if (!(name in resolve)) throw new Error(`unregistered ${name}`)
      return resolve[name] as T
    },
  }
}

beforeEach(() => {
  mockRunIngest.mockReset()
  mockRunMaintenance.mockReset()
  mockBullAdd.mockClear()
  mockBullProcessor = null
})

describe('worker metadata', () => {
  it('declares the ingest queue, concurrency 2, the literal lock duration and the abandonment hook', () => {
    expect(ingestMetadata).toMatchObject({
      queue: INBOX_OPS_ATTACHMENT_INGEST_QUEUE,
      id: 'inbox_ops:attachment-ingest',
      concurrency: INBOX_OPS_ATTACHMENT_INGEST_CONCURRENCY,
      lockDuration: INBOX_OPS_ATTACHMENT_INGEST_LOCK_DURATION_MS,
    })
    expect(typeof ingestMetadata.onJobAbandoned).toBe('function')
    expect(maintenanceMetadata).toEqual({ queue: INBOX_OPS_ATTACHMENT_MAINTENANCE_QUEUE, id: 'inbox_ops:attachment-maintenance', concurrency: 1 })
  })
})

describe('ingest queue', () => {
  it('is created without coalesceBy, with the default attempts', () => {
    const spy = jest.spyOn(queueModule, 'createModuleQueue')
    getInboundAttachmentIngestQueue()
    expect(spy).toHaveBeenCalledWith(INBOX_OPS_ATTACHMENT_INGEST_QUEUE, {
      concurrency: INBOX_OPS_ATTACHMENT_INGEST_CONCURRENCY,
      attempts: INBOX_OPS_ATTACHMENT_INGEST_QUEUE_ATTEMPTS,
    })
    const options = spy.mock.calls[0]?.[1] as Record<string, unknown>
    expect('coalesceBy' in options).toBe(false)
    spy.mockRestore()
  })

  it('enqueues exactly the four job fields and never passes coalesce', async () => {
    const queue = { enqueue: jest.fn(async () => 'id') }
    await enqueueInboundAttachmentIngestJob({ ...job, extra: 'dropped' } as InboundAttachmentIngestJob, { queue })
    await enqueueInboundAttachmentIngestJob(job, { queue, delayMs: 900_000 })
    expect(queue.enqueue.mock.calls).toEqual([[job], [job, { delayMs: 900_000 }]])
  })
})

describe('reenqueueInboundAttachmentIngest', () => {
  it('reserves with a conditional UPDATE … RETURNING, enqueues, then confirms only a lower generation', async () => {
    const { em, execute, nativeUpdate } = fakeEm(5)
    const queue = { enqueue: jest.fn(async () => 'queued') }
    const now = new Date('2026-11-08T10:00:00.000Z')
    const result = await reenqueueInboundAttachmentIngest({ em, email: { id: job.emailId, tenantId: job.tenantId, organizationId: job.organizationId }, delayMs: 60_000, queue, now: () => now })
    expect(result).toEqual({ kind: 'enqueued', generation: 5, jobId: 'queued', confirmed: true })
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql.startsWith(RESERVE_INBOUND_ATTACHMENT_GENERATION_SQL)).toBe(true)
    expect(sql).toContain("attachments_status in ('pending', 'processing')")
    expect(sql).toContain('deleted_at is null')
    expect(sql).toContain('returning attachments_ingest_generation')
    expect(sql).not.toContain('attachments_current_generation, 0) <=')
    expect(sql).not.toContain('updated_at')
    expect(params).toEqual([job.emailId, job.tenantId, job.organizationId])
    expect(queue.enqueue).toHaveBeenCalledWith({ ...job, generation: 5 }, { delayMs: 60_000 })
    expect(nativeUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: job.emailId, $or: [{ attachmentsCurrentGeneration: null }, { attachmentsCurrentGeneration: { $lt: 5 } }] }),
      { attachmentsCurrentGeneration: 5, attachmentsNextRunAt: new Date(now.getTime() + 60_000) },
    )
    expect(execute.mock.invocationCallOrder[0]).toBeLessThan(queue.enqueue.mock.invocationCallOrder[0])
    expect(queue.enqueue.mock.invocationCallOrder[0]).toBeLessThan(nativeUpdate.mock.invocationCallOrder[0])
  })

  it('requires the job not to be superseded for worker and abandonment callers', async () => {
    const { em, execute } = fakeEm(5)
    await reenqueueInboundAttachmentIngest({ em, email: { id: job.emailId, tenantId: job.tenantId, organizationId: job.organizationId }, jobGeneration: 4, queue: { enqueue: jest.fn(async () => 'q') } })
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('coalesce(attachments_current_generation, 0) <= ?')
    expect(params).toEqual([job.emailId, job.tenantId, job.organizationId, 4])
  })

  it('enqueues and confirms nothing when the reservation matches no row', async () => {
    const { em, nativeUpdate } = fakeEm(null)
    const queue = { enqueue: jest.fn(async () => 'q') }
    expect(await reenqueueInboundAttachmentIngest({ em, email: { id: job.emailId, tenantId: job.tenantId, organizationId: job.organizationId }, queue })).toEqual({ kind: 'not_reserved' })
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(nativeUpdate).not.toHaveBeenCalled()
  })

  it('confirms nothing when the enqueue fails', async () => {
    const { em, nativeUpdate } = fakeEm(5)
    const error = new Error('redis down')
    const result = await reenqueueInboundAttachmentIngest({ em, email: { id: job.emailId, tenantId: job.tenantId, organizationId: job.organizationId }, queue: { enqueue: jest.fn(async () => { throw error }) } })
    expect(result).toEqual({ kind: 'enqueue_failed', generation: 5, error })
    expect(nativeUpdate).not.toHaveBeenCalled()
  })

  it('reports an enqueued but unconfirmed job when the confirmation fails', async () => {
    const { em, nativeUpdate } = fakeEm(5)
    nativeUpdate.mockRejectedValueOnce(new Error('db blip'))
    const result = await reenqueueInboundAttachmentIngest({ em, email: { id: job.emailId, tenantId: job.tenantId, organizationId: job.organizationId }, queue: { enqueue: jest.fn(async () => 'q') } })
    expect(result).toEqual({ kind: 'enqueued', generation: 5, jobId: 'q', confirmed: false })
  })
})

describe('workers under both queue strategies', () => {
  const em = { fork: () => em }
  const resolve = { em, attachmentService: { createScoped: jest.fn() }, tenantEncryptionService: { encryptEntityPayload: jest.fn() } }

  it('runs the ingest and maintenance workers with the local strategy', async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), 'inbox-ingest-queue-'))
    try {
      const ingestQueue = createQueue<InboundAttachmentIngestJob>(INBOX_OPS_ATTACHMENT_INGEST_QUEUE, 'local', { baseDir })
      await enqueueInboundAttachmentIngestJob(job, { queue: ingestQueue })
      const processed = await ingestQueue.process((queued, ctx) => ingestWorker(queued as QueuedJob<unknown>, { ...workerContext(resolve), ...ctx }), { limit: 1 })
      expect(processed.processed).toBe(1)
      expect(mockRunIngest).toHaveBeenCalledWith(job, { attemptNumber: 1 }, expect.objectContaining({
        em,
        attachmentService: resolve.attachmentService,
        encryptionService: resolve.tenantEncryptionService,
      }))
      await ingestQueue.close()

      const maintenanceQueue = createQueue<Record<string, unknown>>(INBOX_OPS_ATTACHMENT_MAINTENANCE_QUEUE, 'local', { baseDir })
      await maintenanceQueue.enqueue({ scope: { tenantId: null, organizationId: null } })
      await maintenanceQueue.process((queued, ctx) => maintenanceWorker(queued as QueuedJob<unknown>, { ...workerContext(resolve), ...ctx }), { limit: 1 })
      expect(mockRunMaintenance).toHaveBeenCalledWith(expect.objectContaining({ em, attachmentService: resolve.attachmentService }))
      await maintenanceQueue.close()
    } finally {
      await rm(baseDir, { recursive: true, force: true })
    }
  })

  it('runs the ingest worker with the async strategy and passes the delay, never a deduplication key', async () => {
    const queue = createQueue<InboundAttachmentIngestJob>(INBOX_OPS_ATTACHMENT_INGEST_QUEUE, 'async', { connection: { url: 'redis://127.0.0.1:6399/0' } })
    await enqueueInboundAttachmentIngestJob(job, { queue, delayMs: 900_000 })
    const [, data, options] = mockBullAdd.mock.calls[0] as unknown as [string, QueuedJob<InboundAttachmentIngestJob>, Record<string, unknown>]
    expect(data.payload).toEqual(job)
    expect(options.delay).toBe(900_000)
    expect('deduplication' in options).toBe(false)

    await queue.process((queued, ctx) => ingestWorker(queued as QueuedJob<unknown>, { ...workerContext(resolve), ...ctx }))
    expect(mockBullProcessor).not.toBeNull()
    await mockBullProcessor?.({ id: 'bull-job-id', data, attemptsMade: 2 })
    expect(mockRunIngest).toHaveBeenCalledWith(job, { attemptNumber: 3 }, expect.anything())
    await queue.close()
  })

  it('ignores an ingest job whose payload is not an ingest job', async () => {
    await ingestWorker({ id: 'x', payload: { emailId: 'nope' }, createdAt: '' }, workerContext(resolve))
    expect(mockRunIngest).not.toHaveBeenCalled()
  })

  it('resolves the attachment service softly', async () => {
    await ingestWorker({ id: 'x', payload: job, createdAt: '' }, workerContext({ em, tenantEncryptionService: resolve.tenantEncryptionService }))
    expect(mockRunIngest).toHaveBeenCalledWith(job, { attemptNumber: 1 }, expect.objectContaining({ attachmentService: null }))
  })
})
