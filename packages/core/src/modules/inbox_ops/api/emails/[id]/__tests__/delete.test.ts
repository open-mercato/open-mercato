/** @jest-environment node */

import { LockMode } from '@mikro-orm/core'
import { OPTIMISTIC_LOCK_CONFLICT_CODE, OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { FakeInboxDb, ORG_ID, TENANT_ID, UPDATED_AT, type Row } from '../../../../lib/__tests__/support/fakeInboxDb'
import { InboxEmail } from '../../../../data/entities'

const mockReportError = jest.fn()
const mockGuardAfterSuccess = jest.fn()
const mockValidateGuard = jest.fn()
const mockFindOne = jest.fn()
const mockReleaseScoped = jest.fn()
const mockReleaseOwnedScoped = jest.fn()
const mockState: { db: FakeInboxDb | null } = { db: null }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => require('../../../../lib/__tests__/support/fakeInboxDb').fakeDecryption.findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => {
    mockFindOne(...args)
    return require('../../../../lib/__tests__/support/fakeInboxDb').fakeDecryption.findOneWithDecryption(...args)
  },
}))
jest.mock('../../../routeHelpers', () => ({
  resolveRequestContext: jest.fn(async () => ({
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    userId: 'user-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    em: mockState.db!.entityManager(),
    container: {
      resolve: (name: string) => {
        if (name === 'attachmentService') return { releaseScoped: mockReleaseScoped, releaseOwnedScoped: mockReleaseOwnedScoped }
        throw new Error(`unregistered ${name}`)
      },
    },
    eventBus: null,
  })),
  extractPathSegment: (url: URL, after: string) => {
    const segments = url.pathname.split('/')
    return segments[segments.indexOf(after) + 1] ?? null
  },
  UnauthorizedError: class UnauthorizedError extends Error {},
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => mockValidateGuard(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => mockGuardAfterSuccess(...args),
}))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }),
}))

import { DELETE } from '../route'
import { claimInboundAttachmentIngest } from '../../../../lib/inboundAttachmentIngest'

let db: FakeInboxDb

function request(emailId: string, expectedUpdatedAt?: string): Request {
  return new Request(`http://localhost/api/inbox_ops/emails/${emailId}`, {
    method: 'DELETE',
    headers: expectedUpdatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedUpdatedAt } : {},
  })
}

function seedEmail(values: Partial<Row> = {}): Row {
  return db.addEmail({ status: 'processed', attachmentsStatus: 'completed', ...values })
}

beforeEach(() => {
  jest.clearAllMocks()
  db = new FakeInboxDb()
  mockState.db = db
  mockValidateGuard.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: null })
  mockReleaseScoped.mockResolvedValue(undefined)
  mockReleaseOwnedScoped.mockResolvedValue({ deleted: 0, repointed: 0, detached: 0 })
})

describe('DELETE /api/inbox_ops/emails/[id]', () => {
  it('without a header deletes as before: one locked read, one update, then the release and the guard callback', async () => {
    const email = seedEmail({ attachmentsClaimToken: 'claim-1', attachmentsStatus: 'processing' })
    const updates: Array<Record<string, unknown>> = []
    db.beforeUpdate = (entity, _where, data) => {
      if (entity === 'email') updates.push(data)
    }

    const response = await DELETE(request(email.id))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    const [, entity, where, options] = mockFindOne.mock.calls[0] as [unknown, unknown, Record<string, unknown>, Record<string, unknown>]
    expect(entity).toBe(InboxEmail)
    expect(where).toEqual({ id: email.id, organizationId: ORG_ID, tenantId: TENANT_ID, deletedAt: null })
    expect(options).toEqual({ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true, fields: ['id', 'updatedAt'] })
    const deletion = updates[0]
    expect(deletion.deletedAt).toBeInstanceOf(Date)
    expect(deletion.attachmentsReleaseRequestedAt).toBe(deletion.deletedAt)
    expect(deletion.attachmentsClaimToken).toBeNull()
    expect('updatedAt' in deletion).toBe(false)
    expect(db.email(email.id)).toMatchObject({ attachmentsStatus: 'completed', attachmentsClaimToken: null })
    expect(mockReleaseOwnedScoped).toHaveBeenCalledWith(expect.objectContaining({ owner: { entityId: 'inbox_ops:inbox_email', recordId: email.id } }))
    expect(mockValidateGuard.mock.invocationCallOrder[0]).toBeLessThan(mockFindOne.mock.invocationCallOrder[0])
    expect(mockGuardAfterSuccess).toHaveBeenCalledTimes(1)
    expect(mockGuardAfterSuccess.mock.invocationCallOrder[0]).toBeLessThan(mockReleaseOwnedScoped.mock.invocationCallOrder[0])
  })

  it('deletes when the header matches the email version', async () => {
    const email = seedEmail()
    const response = await DELETE(request(email.id, UPDATED_AT.toISOString()))
    expect(response.status).toBe(200)
    expect(db.email(email.id).deletedAt).toBeInstanceOf(Date)
  })

  it('answers 409 with the conflict body for a stale header and leaves the email untouched', async () => {
    const email = seedEmail()
    const stale = new Date(UPDATED_AT.getTime() - 60_000).toISOString()

    const response = await DELETE(request(email.id, stale))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'record_modified',
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: UPDATED_AT.toISOString(),
      expectedUpdatedAt: stale,
    })
    expect(db.email(email.id).deletedAt).toBeNull()
    expect(db.email(email.id).attachmentsReleaseRequestedAt).toBeNull()
    expect(mockReleaseOwnedScoped).not.toHaveBeenCalled()
    expect(mockGuardAfterSuccess).not.toHaveBeenCalled()
  })

  it('answers 409 for an already deleted email when the header is present, and 404 without it', async () => {
    const email = seedEmail({ deletedAt: new Date('2026-02-01T00:00:00.000Z') })

    const withHeader = await DELETE(request(email.id, UPDATED_AT.toISOString()))
    expect(withHeader.status).toBe(409)
    expect(await withHeader.json()).toMatchObject({ code: OPTIMISTIC_LOCK_CONFLICT_CODE })

    const withoutHeader = await DELETE(request(email.id))
    expect(withoutHeader.status).toBe(404)
    expect(await withoutHeader.json()).toEqual({ error: 'Email not found' })
    expect(mockReleaseOwnedScoped).not.toHaveBeenCalled()
    expect(mockGuardAfterSuccess).not.toHaveBeenCalled()
  })

  it('answers 404 for a missing email without a header', async () => {
    const response = await DELETE(request('33333333-3333-4333-8333-333333333333'))
    expect(response.status).toBe(404)
  })

  it('answers 404 for a non-uuid id before the guard and without reading', async () => {
    const response = await DELETE(request('not-a-uuid', UPDATED_AT.toISOString()))
    expect(response.status).toBe(404)
    expect(mockValidateGuard).not.toHaveBeenCalled()
    expect(mockFindOne).not.toHaveBeenCalled()
  })

  it('maps a mutation guard refusal to its own status before reading the email', async () => {
    const email = seedEmail()
    mockValidateGuard.mockResolvedValue({ ok: false, status: 423, body: { error: 'Locked' } })
    const response = await DELETE(request(email.id))
    expect(response.status).toBe(423)
    expect(mockFindOne).not.toHaveBeenCalled()
    expect(db.email(email.id).deletedAt).toBeNull()
  })

  it('keeps answering 200 when the release fails, and reports it for the sweep', async () => {
    const email = seedEmail()
    mockReleaseOwnedScoped.mockRejectedValue(new Error('storage down'))
    const response = await DELETE(request(email.id))
    expect(response.status).toBe(200)
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'inbox_ops.attachment_release_failed' }))
    expect(db.email(email.id).attachmentsReleasedAt).toBeNull()
  })

  it('leaves updated_at unchanged through an ingest claim, the deletion and the release, so a loaded version stays valid', async () => {
    const email = seedEmail({ attachmentsStatus: 'pending' })
    db.addPart(email.id, 'stored', { status: 'stored', attachmentId: '00000000-0000-4000-8000-000000000001' })
    db.addPart(email.id, 'skipped', { status: 'skipped', reason: 'too_large' })
    const ref = { id: email.id, tenantId: TENANT_ID, organizationId: ORG_ID }

    expect(await claimInboundAttachmentIngest(db.entityManager(), ref, { generation: 1, token: 'claim-1', now: new Date(), leaseMs: 60_000 })).toBe(true)
    expect(db.email(email.id).updatedAt).toBe(UPDATED_AT)

    const response = await DELETE(request(email.id, UPDATED_AT.toISOString()))

    expect(response.status).toBe(200)
    const deleted = db.email(email.id)
    expect(deleted.updatedAt).toBe(UPDATED_AT)
    expect(deleted.attachmentsReleasedAt).toBeInstanceOf(Date)
    expect(db.partsOf(email.id).map((part) => part.status)).toEqual(['released', 'released'])
  })
})
