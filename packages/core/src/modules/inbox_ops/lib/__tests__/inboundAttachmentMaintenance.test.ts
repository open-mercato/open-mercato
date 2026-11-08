/** @jest-environment node */

import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { FakeInboxDb, ORG_ID, TENANT_ID } from './support/fakeInboxDb'
import { INBOX_OPS_ATTACHMENT_FINALIZE_AFTER_MS } from '../inboundAttachmentIngest'
import { resetInboundAttachmentConfigReportsForTests, resetInboundAttachmentGateWarningsForTests } from '../inboundAttachments'
import { INBOX_OPS_ATTACHMENT_MAINTENANCE_QUEUE, runInboundAttachmentMaintenance } from '../inboundAttachmentMaintenance'
import { releaseInboundEmailAttachments, softDeleteInboxEmailForRelease } from '../inboundAttachmentRelease'
import {
  ensureInboundAttachmentMaintenanceSchedule,
  ensureInboundAttachmentMaintenanceScheduleLazily,
  INBOX_OPS_ATTACHMENT_MAINTENANCE_CRON,
  INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID,
  resetInboundAttachmentScheduleRegistrationForTests,
  stableInboxOpsScheduleUuid,
} from '../inboundAttachmentSchedule'
import { setup } from '../../setup'

const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => require('./support/fakeInboxDb').fakeDecryption.findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => require('./support/fakeInboxDb').fakeDecryption.findOneWithDecryption(...args),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

const MINUTE = 60 * 1000
const NOW = new Date('2026-11-08T12:00:00.000Z')
const LEASE_MS = 30 * MINUTE

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms)
}

function ref(id: string) {
  return { id, tenantId: TENANT_ID, organizationId: ORG_ID }
}

function sweep(db: FakeInboxDb, overrides: Partial<Parameters<typeof runInboundAttachmentMaintenance>[0]> = {}) {
  return runInboundAttachmentMaintenance({
    em: db.entityManager(),
    queue: { enqueue: jest.fn(async () => 'job') },
    config: { leaseMs: LEASE_MS },
    listUnguardedReaders: () => [],
    now: () => NOW,
    ...overrides,
  })
}

beforeEach(() => {
  mockReportError.mockReset()
  resetInboundAttachmentGateWarningsForTests()
})

describe('maintenance sweep: configuration', () => {
  it('keeps sweeping with the default lease under a malformed environment and reports it', async () => {
    resetInboundAttachmentConfigReportsForTests()
    const previous = process.env.INBOX_OPS_ATTACHMENT_LEASE_MS
    process.env.INBOX_OPS_ATTACHMENT_LEASE_MS = 'half an hour'
    try {
      const db = new FakeInboxDb()
      const stranded = db.addEmail({ attachmentsNextRunAt: ago(16 * MINUTE) })
      const result = await sweep(db, { config: undefined })
      expect(result.reenqueued).toBe(1)
      expect(db.email(stranded.id).attachmentsCurrentGeneration).toBe(2)
      expect(mockReportError.mock.calls.map((call) => (call[1] as { code: string }).code)).toEqual(['inbox_ops.attachment_config_invalid'])
    } finally {
      if (previous === undefined) delete process.env.INBOX_OPS_ATTACHMENT_LEASE_MS
      else process.env.INBOX_OPS_ATTACHMENT_LEASE_MS = previous
    }
  })
})

describe('maintenance sweep: stranded emails', () => {
  it('re-enqueues only emails 15 minutes past their due time, oldest first', async () => {
    const db = new FakeInboxDb()
    const waiting = db.addEmail({ attachmentsNextRunAt: ago(14 * MINUTE) })
    const delayed = db.addEmail({ attachmentsNextRunAt: new Date(NOW.getTime() + 10 * MINUTE) })
    const stranded = db.addEmail({ attachmentsNextRunAt: ago(16 * MINUTE) })
    const older = db.addEmail({ attachmentsNextRunAt: ago(60 * MINUTE) })
    const queue = { enqueue: jest.fn(async () => 'job') }
    const result = await sweep(db, { queue })
    expect(result.reenqueued).toBe(2)
    expect(queue.enqueue.mock.calls.map((call) => (call[0] as { emailId: string }).emailId)).toEqual([older.id, stranded.id])
    expect(db.email(waiting.id).attachmentsCurrentGeneration).toBe(1)
    expect(db.email(delayed.id).attachmentsCurrentGeneration).toBe(1)
    expect(db.email(stranded.id)).toMatchObject({ attachmentsCurrentGeneration: 2, attachmentsNextRunAt: NOW })
  })

  it('does not re-enqueue a processing email whose lease just expired before 15 minutes past its due time', async () => {
    const db = new FakeInboxDb()
    const justExpired = db.addEmail({ attachmentsStatus: 'processing', attachmentsClaimToken: 'x', attachmentsClaimedAt: ago(LEASE_MS + MINUTE), attachmentsNextRunAt: ago(10 * MINUTE) })
    const live = db.addEmail({ attachmentsStatus: 'processing', attachmentsClaimToken: 'y', attachmentsClaimedAt: ago(MINUTE), attachmentsNextRunAt: ago(60 * MINUTE) })
    const stranded = db.addEmail({ attachmentsStatus: 'processing', attachmentsClaimToken: 'z', attachmentsClaimedAt: ago(LEASE_MS + MINUTE), attachmentsNextRunAt: ago(40 * MINUTE) })
    const queue = { enqueue: jest.fn(async () => 'job') }
    await sweep(db, { queue })
    expect(queue.enqueue.mock.calls.map((call) => (call[0] as { emailId: string }).emailId)).toEqual([stranded.id])
    expect(db.email(justExpired.id).attachmentsCurrentGeneration).toBe(1)
    expect(db.email(live.id).attachmentsCurrentGeneration).toBe(1)
  })

  it('leaves the previous job current and the due time unchanged when the recovery enqueue fails, and reports it', async () => {
    const db = new FakeInboxDb()
    const nextRunAt = ago(20 * MINUTE)
    const email = db.addEmail({ attachmentsNextRunAt: nextRunAt })
    const result = await sweep(db, { queue: { enqueue: jest.fn(async () => { throw new Error('redis down') }) } })
    expect(result).toMatchObject({ reenqueued: 0, requeueFailed: 1 })
    expect(db.email(email.id)).toMatchObject({ attachmentsCurrentGeneration: 1, attachmentsNextRunAt: nextRunAt })
    expect(mockReportError.mock.calls.map((call) => (call[1] as { code: string }).code)).toEqual(['inbox_ops.attachment_requeue_failed'])
  })

  it('never finalizes: an email past its 6-hour window is only re-enqueued', async () => {
    const db = new FakeInboxDb()
    const email = db.addEmail({ attachmentsNextRunAt: ago(20 * MINUTE), attachmentsFirstFailureAt: ago(INBOX_OPS_ATTACHMENT_FINALIZE_AFTER_MS * 2) })
    const part = db.addPart(email.id, 'a')
    const result = await sweep(db)
    expect(result.reenqueued).toBe(1)
    expect(db.part(part.id)).toMatchObject({ status: 'pending', reason: null })
    expect(db.email(email.id).attachmentsStatus).toBe('pending')
  })

  it('completes soft-deleted pending and processing emails without re-enqueueing them', async () => {
    const db = new FakeInboxDb()
    const pending = db.addEmail({ deletedAt: ago(MINUTE), attachmentsNextRunAt: ago(60 * MINUTE) })
    const processing = db.addEmail({ deletedAt: ago(MINUTE), attachmentsStatus: 'processing', attachmentsClaimToken: 'x', attachmentsClaimedAt: ago(2 * LEASE_MS) })
    const queue = { enqueue: jest.fn(async () => 'job') }
    const result = await sweep(db, { queue })
    expect(result.completedDeleted).toBe(2)
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(db.email(pending.id)).toMatchObject({ attachmentsStatus: 'completed', attachmentsClaimToken: null })
    expect(db.email(processing.id)).toMatchObject({ attachmentsStatus: 'completed', attachmentsClaimToken: null })
  })
})

describe('maintenance sweep: releases', () => {
  it('retries the release of deleted emails until it succeeds, and never sweeps emails deleted before the upgrade', async () => {
    const db = new FakeInboxDb()
    const email = db.addEmail({ attachmentsStatus: 'completed' })
    const stored = db.addPart(email.id, 'a', { status: 'stored', attachmentId: '44444444-4444-4444-8444-444444444444', extractedText: 'secret' })
    await softDeleteInboxEmailForRelease(db.entityManager(), ref(email.id), ago(MINUTE))
    const preUpgrade = db.addEmail({ attachmentsStatus: null, deletedAt: ago(60 * MINUTE) })
    const releaseScoped = jest.fn()
      .mockRejectedValueOnce(new Error('storage down'))
      .mockResolvedValue(undefined)
    const releaseOwnedScoped = jest.fn(async () => ({ deleted: 0, repointed: 0, detached: 0 }))
    const attachmentService = { releaseScoped, releaseOwnedScoped }

    expect(await sweep(db, { attachmentService })).toMatchObject({ released: 0, releaseDeferred: 1 })
    expect(db.email(email.id).attachmentsReleasedAt).toBeNull()
    expect(await sweep(db, { attachmentService })).toMatchObject({ released: 1, releaseDeferred: 0 })
    expect(db.email(email.id).attachmentsReleasedAt).toEqual(NOW)
    expect(db.part(stored.id)).toMatchObject({ status: 'released', fileName: null, extractedText: null })
    expect(releaseOwnedScoped.mock.calls.every((call) => (call as unknown[])[0] && ((call as unknown[])[0] as { owner: { recordId: string } }).owner.recordId === email.id)).toBe(true)
    expect(await sweep(db, { attachmentService })).toMatchObject({ released: 0, releaseDeferred: 0 })
    expect(db.email(preUpgrade.id).attachmentsReleasedAt).toBeNull()
  })

  it('defers releases while the attachment service is absent', async () => {
    const db = new FakeInboxDb()
    const email = db.addEmail({ attachmentsStatus: 'completed' })
    await softDeleteInboxEmailForRelease(db.entityManager(), ref(email.id), ago(MINUTE))
    expect(await sweep(db, { attachmentService: null })).toMatchObject({ released: 0, releaseDeferred: 0 })
    expect(db.email(email.id).attachmentsReleasedAt).toBeNull()
  })

  it('warns while stored rows are readable through an unguarded reader', async () => {
    const db = new FakeInboxDb()
    const email = db.addEmail({ attachmentsStatus: 'completed' })
    db.addPart(email.id, 'a', { status: 'stored', attachmentId: '44444444-4444-4444-8444-444444444444' })
    expect((await sweep(db, { listUnguardedReaders: () => ['agent_orchestrator'] })).storedReadableByUnguardedReader).toBe(true)
    resetInboundAttachmentGateWarningsForTests()
    expect((await sweep(db, { listUnguardedReaders: () => [] })).storedReadableByUnguardedReader).toBe(false)
  })
})

describe('releaseInboundEmailAttachments', () => {
  function deletedEmail(db: FakeInboxDb) {
    const email = db.addEmail({ attachmentsStatus: 'completed', deletedAt: NOW, attachmentsReleaseRequestedAt: NOW })
    return email
  }

  it('marks parts that were never stored released at once, and stored parts only after their own release', async () => {
    const db = new FakeInboxDb()
    const email = deletedEmail(db)
    const pending = db.addPart(email.id, 'p', { status: 'pending' })
    const skipped = db.addPart(email.id, 's', { status: 'skipped', reason: 'too_large' })
    const stored = db.addPart(email.id, 'x', { status: 'stored', attachmentId: '55555555-5555-4555-8555-555555555555', extractedText: 't' })
    const result = await releaseInboundEmailAttachments({
      em: db.entityManager(),
      email: ref(email.id),
      attachmentService: { releaseScoped: jest.fn(async () => { throw new Error('storage down') }), releaseOwnedScoped: jest.fn(async () => ({ deleted: 0, repointed: 0, detached: 0 })) },
      now: () => NOW,
    })
    expect(result).toMatchObject({ fullyReleased: false, releasedParts: 0, remainingParts: 1 })
    expect(db.part(pending.id)).toMatchObject({ status: 'released', fileName: null })
    expect(db.part(skipped.id)).toMatchObject({ status: 'released', fileName: null })
    expect(db.part(stored.id)).toMatchObject({ status: 'stored', extractedText: 't' })
    expect(db.email(email.id).attachmentsReleasedAt).toBeNull()
    expect(mockReportError.mock.calls.map((call) => (call[1] as { code: string }).code)).toEqual(['inbox_ops.attachment_release_failed'])
  })

  it('treats a 404 as released and settles a part still referenced elsewhere through releaseOwnedScoped', async () => {
    const db = new FakeInboxDb()
    const email = deletedEmail(db)
    const gone = db.addPart(email.id, 'gone', { status: 'stored', attachmentId: '55555555-5555-4555-8555-555555555551' })
    const shared = db.addPart(email.id, 'shared', { status: 'stored', attachmentId: '55555555-5555-4555-8555-555555555552' })
    const releaseScoped = jest.fn(async (input: { attachmentId: string }) => {
      if (input.attachmentId.endsWith('1')) throw new CrudHttpError(404, { error: 'not found' })
      throw new CrudHttpError(409, { error: 'still referenced' })
    })
    const releaseOwnedScoped = jest.fn(async () => ({ deleted: 1, repointed: 1, detached: 1 }))
    const result = await releaseInboundEmailAttachments({ em: db.entityManager(), email: ref(email.id), attachmentService: { releaseScoped, releaseOwnedScoped }, now: () => NOW })
    expect(result).toMatchObject({ fullyReleased: true, markedReleased: true, releasedParts: 2 })
    expect(releaseOwnedScoped).toHaveBeenCalledWith({ owner: { entityId: 'inbox_ops:inbox_email', recordId: email.id }, tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(db.part(gone.id).status).toBe('released')
    expect(db.part(shared.id).status).toBe('released')
    expect(db.email(email.id).attachmentsReleasedAt).toEqual(NOW)
  })

  it('removes planted rows of an email without a ledger and keeps the email in the deny set when that fails', async () => {
    const db = new FakeInboxDb()
    const email = db.addEmail({ attachmentsStatus: null, deletedAt: NOW, attachmentsReleaseRequestedAt: NOW })
    const failing = jest.fn(async () => { throw new Error('db down') })
    const first = await releaseInboundEmailAttachments({ em: db.entityManager(), email: ref(email.id), attachmentService: { releaseScoped: jest.fn(), releaseOwnedScoped: failing }, now: () => NOW })
    expect(first.fullyReleased).toBe(false)
    expect(db.email(email.id).attachmentsReleasedAt).toBeNull()
    const second = await releaseInboundEmailAttachments({
      em: db.entityManager(),
      email: ref(email.id),
      attachmentService: { releaseScoped: jest.fn(), releaseOwnedScoped: jest.fn(async () => ({ deleted: 2, repointed: 0, detached: 1 })) },
      now: () => NOW,
    })
    expect(second).toMatchObject({ fullyReleased: true, markedReleased: true })
  })

  it('defers everything but the never-stored parts without the attachment service', async () => {
    const db = new FakeInboxDb()
    const email = deletedEmail(db)
    const stored = db.addPart(email.id, 'x', { status: 'stored', attachmentId: '55555555-5555-4555-8555-555555555555' })
    const failed = db.addPart(email.id, 'f', { status: 'failed', reason: 'fetch_failed' })
    const result = await releaseInboundEmailAttachments({ em: db.entityManager(), email: ref(email.id), attachmentService: null, now: () => NOW })
    expect(result).toMatchObject({ deferred: true, fullyReleased: false, remainingParts: 1 })
    expect(db.part(stored.id).status).toBe('stored')
    expect(db.part(failed.id).status).toBe('released')
  })

  it('clears names and texts through the encryption service', async () => {
    const db = new FakeInboxDb()
    const email = deletedEmail(db)
    db.addPart(email.id, 'f', { status: 'failed', reason: 'fetch_failed' })
    const encryptEntityPayload = jest.fn(async (_entityId: string, payload: Record<string, unknown>) => payload)
    await releaseInboundEmailAttachments({ em: db.entityManager(), email: ref(email.id), attachmentService: null, encryptionService: { encryptEntityPayload }, now: () => NOW })
    expect(encryptEntityPayload).toHaveBeenCalledWith('inbox_ops:inbox_email_attachment', { fileName: null, extractedText: null }, TENANT_ID, ORG_ID)
  })
})

describe('deletion update', () => {
  it('soft-deletes, requests release, invalidates the claim and completes only an ingest email, leaving updated_at alone', async () => {
    const db = new FakeInboxDb()
    const ingest = db.addEmail({ attachmentsStatus: 'processing', attachmentsClaimToken: 'claim', attachmentsClaimedAt: NOW })
    const plain = db.addEmail({ attachmentsStatus: null })
    expect(await softDeleteInboxEmailForRelease(db.entityManager(), ref(ingest.id), NOW)).toBe(true)
    expect(await softDeleteInboxEmailForRelease(db.entityManager(), ref(plain.id), NOW)).toBe(true)
    expect(await softDeleteInboxEmailForRelease(db.entityManager(), ref(plain.id), NOW)).toBe(false)
    expect(db.email(ingest.id)).toMatchObject({ deletedAt: NOW, attachmentsReleaseRequestedAt: NOW, attachmentsClaimToken: null, attachmentsStatus: 'completed' })
    expect(db.email(plain.id)).toMatchObject({ deletedAt: NOW, attachmentsReleaseRequestedAt: NOW, attachmentsStatus: null })
    expect(db.email(ingest.id).updatedAt).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })
})

describe('maintenance schedule', () => {
  beforeEach(() => resetInboundAttachmentScheduleRegistrationForTests())

  function container(service: Record<string, unknown> | null) {
    return {
      hasRegistration: (name: string) => name === 'schedulerService' && service !== null,
      resolve: (name: string) => {
        if (name !== 'schedulerService' || !service) throw new Error(`unregistered ${name}`)
        return service
      },
    }
  }

  it('uses a deterministic id that passes the scheduler validators', () => {
    expect(INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID).toBe(stableInboxOpsScheduleUuid('inbox_ops:attachment-maintenance'))
    expect(z.uuid().safeParse(INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID).success).toBe(true)
    for (const schema of [z.object({ id: z.guid() }), z.object({ id: z.uuid() })]) {
      expect(schema.parse({ id: INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID })).toEqual({ id: INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID })
    }
    expect(INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID[14]).toBe('5')
    expect(['8', '9', 'a', 'b']).toContain(INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID[19])
  })

  it('registers the system cron schedule only when it is missing', async () => {
    const register = jest.fn(async () => undefined)
    const exists = jest.fn(async () => false)
    expect(await ensureInboundAttachmentMaintenanceSchedule(container({ register, exists }))).toBe('registered')
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      id: INBOX_OPS_ATTACHMENT_MAINTENANCE_SCHEDULE_ID,
      scopeType: 'system',
      scheduleType: 'cron',
      scheduleValue: INBOX_OPS_ATTACHMENT_MAINTENANCE_CRON,
      targetType: 'queue',
      targetQueue: INBOX_OPS_ATTACHMENT_MAINTENANCE_QUEUE,
      sourceType: 'module',
      sourceModule: 'inbox_ops',
    }))
    expect(INBOX_OPS_ATTACHMENT_MAINTENANCE_CRON).toBe('*/15 * * * *')

    exists.mockResolvedValue(true)
    register.mockClear()
    expect(await ensureInboundAttachmentMaintenanceSchedule(container({ register, exists }))).toBe('exists')
    expect(register).not.toHaveBeenCalled()
  })

  it('is soft-optional on the scheduler module', async () => {
    expect(await ensureInboundAttachmentMaintenanceSchedule(container(null))).toBe('scheduler_unavailable')
  })

  it('registers from seedDefaults without failing tenant setup', async () => {
    const register = jest.fn(async () => { throw new Error('db down') })
    const service = { register, exists: jest.fn(async () => false) }
    await expect(setup.seedDefaults?.({ container: container(service) } as never)).resolves.toBeUndefined()
    expect(register).toHaveBeenCalledTimes(1)
    expect(mockReportError.mock.calls.map((call) => (call[1] as { code: string }).code)).toEqual(['inbox_ops.attachment_schedule_failed'])
  })

  it('registers lazily once per process and retries after a failure', async () => {
    const exists = jest.fn(async () => false)
    const register = jest.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(undefined)
    const scheduler = container({ register, exists })
    expect(await ensureInboundAttachmentMaintenanceScheduleLazily(scheduler)).toBe('failed')
    expect(await ensureInboundAttachmentMaintenanceScheduleLazily(scheduler)).toBe('registered')
    expect(await ensureInboundAttachmentMaintenanceScheduleLazily(scheduler)).toBe('registered')
    expect(register).toHaveBeenCalledTimes(2)
    expect(exists).toHaveBeenCalledTimes(2)
  })
})
