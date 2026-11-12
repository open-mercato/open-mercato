/** @jest-environment node */

import { InboxProposal, InboxProposalAction } from '../../../../../data/entities'
import { FakeInboxDb, ORG_ID, TENANT_ID, type Row } from '../../../../../lib/__tests__/support/fakeInboxDb'

const mockEnqueue = jest.fn()
const mockEmit = jest.fn()
const mockReportError = jest.fn()
const mockState: { db: FakeInboxDb | null } = { db: null }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => require('../../../../../lib/__tests__/support/fakeInboxDb').fakeDecryption.findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => require('../../../../../lib/__tests__/support/fakeInboxDb').fakeDecryption.findOneWithDecryption(...args),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: '11111111-1111-4111-8111-111111111111', orgId: '22222222-2222-4222-8222-222222222222' })),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string): unknown => (token === 'em' ? mockState.db?.entityManager() : null),
  })),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))
jest.mock('@open-mercato/queue', () => ({
  ...jest.requireActual('@open-mercato/queue'),
  createModuleQueue: () => ({ enqueue: (...args: unknown[]) => mockEnqueue(...args) }),
}))
jest.mock('@open-mercato/core/modules/inbox_ops/lib/eventBus', () => ({
  resolveOptionalEventBus: jest.fn(() => null),
}))
jest.mock('@open-mercato/core/modules/inbox_ops/events', () => ({
  emitInboxOpsEvent: (...args: unknown[]) => mockEmit(...args),
}))

import { POST } from '../route'

const MINUTE = 60 * 1000

let db: FakeInboxDb

function request(emailId: string): Request {
  return new Request(`http://localhost/api/inbox_ops/emails/${emailId}/reprocess`, { method: 'POST' })
}

function seedProposal(emailId: string, actionStatus: string): Row {
  const proposal: Row = {
    id: `proposal-${emailId}`,
    inboxEmailId: emailId,
    status: 'pending',
    isActive: true,
    metadata: {},
    deletedAt: null,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  }
  db.table(InboxProposal).set(proposal.id, proposal)
  db.table(InboxProposalAction).set(`action-${emailId}`, {
    id: `action-${emailId}`,
    proposalId: proposal.id,
    status: actionStatus,
    deletedAt: null,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  })
  return proposal
}

function seedFinalized(values: Partial<Row> = {}): Row {
  const email = db.addEmail({
    status: 'processed',
    attachmentsStatus: 'completed',
    attachmentsFirstFailureAt: new Date(Date.now() - 7 * 60 * MINUTE),
    attachmentsCurrentGeneration: 3,
    attachmentsIngestGeneration: 3,
    attachmentsNextRunAt: new Date(Date.now() - 7 * 60 * MINUTE),
    ...values,
  })
  db.addPart(email.id, 'stored', { status: 'stored', attachmentId: '00000000-0000-4000-8000-000000000001' })
  db.addPart(email.id, 'timeout', { status: 'failed', reason: 'ingest_timeout', attempts: 2, inFlightAt: new Date(Date.now() - 7 * 60 * MINUTE) })
  db.addPart(email.id, 'quota', { status: 'failed', reason: 'quota_exceeded', attempts: 1 })
  db.addPart(email.id, 'gone', { status: 'failed', reason: 'fetch_failed', attempts: 3 })
  db.addPart(email.id, 'huge', { status: 'skipped', reason: 'too_large' })
  return email
}

function partStates(emailId: string): Array<[unknown, unknown, unknown]> {
  return db.partsOf(emailId).map((row) => [row.partKey, row.status, row.reason])
}

function emittedEvents(): unknown[] {
  return mockEmit.mock.calls.map((call) => call[0])
}

beforeEach(() => {
  jest.clearAllMocks()
  mockEnqueue.mockImplementation(async () => 'job-id')
  mockEmit.mockResolvedValue(undefined)
  db = new FakeInboxDb()
  mockState.db = db
})

describe('manual retry of a waiting or stranded ingest', () => {
  it('clears the first failure, re-enqueues, retires no proposal, changes no status and emits nothing (200)', async () => {
    const email = db.addEmail({
      status: 'received',
      attachmentsStatus: 'pending',
      attachmentsFirstFailureAt: new Date(Date.now() - 2 * 60 * MINUTE),
      attachmentsNextRunAt: new Date(Date.now() - 60 * MINUTE),
    })
    const proposal = seedProposal(email.id, 'pending')

    const response = await POST(request(email.id))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, retiredProposalCount: 0, retiredActionCount: 0 })
    expect(db.email(email.id)).toMatchObject({
      status: 'received',
      attachmentsStatus: 'pending',
      attachmentsFirstFailureAt: null,
      attachmentsCurrentGeneration: 2,
    })
    expect(db.email(email.id).updatedAt).toEqual(email.updatedAt)
    expect(mockEnqueue.mock.calls.map((call) => call[0])).toEqual([
      { emailId: email.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 2 },
    ])
    expect(db.table(InboxProposal).get(proposal.id)).toMatchObject({ isActive: true, status: 'pending' })
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('re-enqueues a processing ingest whose lease expired', async () => {
    const email = db.addEmail({ attachmentsStatus: 'processing', attachmentsClaimedAt: new Date(Date.now() - 31 * MINUTE), attachmentsClaimToken: 'token' })

    const response = await POST(request(email.id))

    expect(response.status).toBe(200)
    expect(mockEnqueue).toHaveBeenCalledTimes(1)
  })

  it('answers 409 while a worker holds a live lease, changing nothing', async () => {
    const firstFailure = new Date(Date.now() - 60 * MINUTE)
    const email = db.addEmail({
      attachmentsStatus: 'processing',
      attachmentsClaimedAt: new Date(Date.now() - MINUTE),
      attachmentsClaimToken: 'token',
      attachmentsFirstFailureAt: firstFailure,
    })

    const response = await POST(request(email.id))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'The attachments of this email are being processed. Try again later.' })
    expect(db.email(email.id)).toMatchObject({ attachmentsFirstFailureAt: firstFailure, attachmentsCurrentGeneration: 1 })
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('answers 500 and reports when the enqueue fails, leaving the previous job current', async () => {
    const email = db.addEmail({ attachmentsStatus: 'pending', attachmentsNextRunAt: new Date(Date.now() - 60 * MINUTE) })
    mockEnqueue.mockRejectedValueOnce(new Error('[internal] queue down'))

    const response = await POST(request(email.id))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Could not queue the attachments of this email. Try again.' })
    expect(db.email(email.id)).toMatchObject({ attachmentsStatus: 'pending', attachmentsCurrentGeneration: 1 })
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({
      code: 'inbox_ops.attachment_requeue_failed',
      attributes: expect.objectContaining({ emailId: email.id, step: 'reprocess' }),
    }))
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('answers 409 when the ingest completed concurrently (the reservation matches no row)', async () => {
    const email = db.addEmail({ attachmentsStatus: 'pending' })
    db.beforeUpdate = () => {
      db.email(email.id).attachmentsStatus = 'completed'
    }

    const response = await POST(request(email.id))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'The attachments of this email can no longer be retried.' })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('answers 404 when the email was deleted concurrently', async () => {
    const email = db.addEmail({ attachmentsStatus: 'pending' })
    db.beforeUpdate = () => {
      db.email(email.id).deletedAt = new Date()
    }

    const response = await POST(request(email.id))

    expect(response.status).toBe(404)
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})

describe('manual retry of a finalized ingest with retryable failed parts', () => {
  it('resets the email and the operator-fixable parts, retires proposals, emits reprocessed only and re-enqueues', async () => {
    const email = seedFinalized()
    seedProposal(email.id, 'pending')

    const response = await POST(request(email.id))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, retiredProposalCount: 1, retiredActionCount: 1 })
    const reset = db.email(email.id)
    expect(reset).toMatchObject({
      status: 'received',
      processingError: null,
      attachmentsStatus: 'pending',
      attachmentsClaimToken: null,
      attachmentsFirstFailureAt: null,
      attachmentsCurrentGeneration: 4,
    })
    expect((reset.attachmentsNextRunAt as Date).getTime()).toBeGreaterThan(Date.now() - MINUTE)
    expect(partStates(email.id)).toEqual([
      ['resend:stored', 'stored', null],
      ['resend:timeout', 'pending', null],
      ['resend:quota', 'pending', null],
      ['resend:gone', 'failed', 'fetch_failed'],
      ['resend:huge', 'skipped', 'too_large'],
    ])
    expect(db.partsOf(email.id).map((row) => [row.partKey, row.attempts, row.inFlightAt])).toEqual([
      ['resend:stored', 0, null],
      ['resend:timeout', 0, null],
      ['resend:quota', 0, null],
      ['resend:gone', 3, null],
      ['resend:huge', 0, null],
    ])
    expect(emittedEvents()).toEqual(['inbox_ops.email.reprocessed'])
    expect(mockEnqueue.mock.calls.map((call) => call[0])).toEqual([
      { emailId: email.id, tenantId: TENANT_ID, organizationId: ORG_ID, generation: 4 },
    ])
  })

  it('answers 500 after the commit when the enqueue fails; the reset email is left pending for recovery', async () => {
    const email = seedFinalized()
    mockEnqueue.mockRejectedValueOnce(new Error('[internal] queue down'))

    const response = await POST(request(email.id))

    expect(response.status).toBe(500)
    expect(db.email(email.id)).toMatchObject({ status: 'received', attachmentsStatus: 'pending', attachmentsCurrentGeneration: 3 })
    expect(emittedEvents()).toEqual(['inbox_ops.email.reprocessed'])
  })

  it('rolls everything back when an action was already executed (409)', async () => {
    const email = seedFinalized()
    seedProposal(email.id, 'executed')

    const response = await POST(request(email.id))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot reprocess after actions were already executed. Open the latest proposal instead.',
    })
    expect(db.email(email.id)).toMatchObject({ status: 'processed', attachmentsStatus: 'completed' })
    expect(partStates(email.id).map((row) => row[1])).toEqual(['stored', 'failed', 'failed', 'failed', 'skipped'])
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('answers 409 when a concurrent reprocess already reset the email, and 404 when it was deleted', async () => {
    const reprocessed = seedFinalized()
    db.beforeUpdate = (entity) => {
      if (entity === 'email') db.applyCommitted('email', reprocessed.id, { attachmentsStatus: 'pending' })
    }
    const conflict = await POST(request(reprocessed.id))
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toEqual({ error: 'This email was already reset for reprocessing.' })

    const deleted = seedFinalized()
    db.beforeUpdate = (entity) => {
      if (entity === 'email') db.applyCommitted('email', deleted.id, { deletedAt: new Date() })
    }
    const gone = await POST(request(deleted.id))
    expect(gone.status).toBe(404)

    expect(partStates(deleted.id).map((row) => row[1])).toEqual(['stored', 'failed', 'failed', 'failed', 'skipped'])
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('keeps answering 409 while extraction is queued', async () => {
    const email = seedFinalized({ status: 'processing' })

    const response = await POST(request(email.id))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Email is already queued for processing' })
    expect(db.email(email.id).attachmentsStatus).toBe('completed')
  })
})

describe('reprocess without a retryable ingest', () => {
  it.each([
    ['without attachments', { attachmentsStatus: null }],
    ['whose ingest completed without retryable parts', { attachmentsStatus: 'completed' }],
  ])('keeps today\'s behavior for an email %s', async (_label, values) => {
    const email = db.addEmail({ status: 'failed', ...values })
    db.addPart(email.id, 'gone', { status: 'failed', reason: 'fetch_failed' })

    const response = await POST(request(email.id))

    expect(response.status).toBe(200)
    expect(emittedEvents()).toEqual(['inbox_ops.email.reprocessed', 'inbox_ops.email.received'])
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(db.email(email.id).attachmentsStatus).toBe(values.attachmentsStatus)
  })

  it('answers 404 for an email of another organization', async () => {
    const email = db.addEmail({ organizationId: '99999999-9999-4999-8999-999999999999', attachmentsStatus: 'pending' })

    const response = await POST(request(email.id))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Email not found' })
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})
