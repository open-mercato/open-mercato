/** @jest-environment node */

import { inboxEmailAttachmentListResponseSchema } from '../../../../../data/validators'
import { FakeInboxDb, ORG_ID, TENANT_ID } from '../../../../../lib/__tests__/support/fakeInboxDb'

const mockGetAuth = jest.fn()
const mockState: { db: FakeInboxDb | null } = { db: null }

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => require('../../../../../lib/__tests__/support/fakeInboxDb').fakeDecryption.findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => require('../../../../../lib/__tests__/support/fakeInboxDb').fakeDecryption.findOneWithDecryption(...args),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string): unknown => (token === 'em' ? mockState.db?.entityManager() : null),
  })),
}))
jest.mock('@open-mercato/core/modules/inbox_ops/lib/eventBus', () => ({
  resolveOptionalEventBus: jest.fn(() => null),
}))

import { InboxEmail, InboxEmailAttachment } from '../../../../../data/entities'
import { GET, INBOX_EMAIL_ATTACHMENT_LIST_FIELDS, metadata, openApi } from '../route'

const OTHER_ORG_ID = '99999999-9999-4999-8999-999999999999'
const STORED_ATTACHMENT_ID = '00000000-0000-4000-8000-000000000001'

let db: FakeInboxDb

function request(emailId: string): Request {
  return new Request(`http://localhost/api/inbox_ops/emails/${emailId}/attachments`)
}

beforeEach(() => {
  db = new FakeInboxDb()
  mockState.db = db
  mockGetAuth.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
})

describe('GET /api/inbox_ops/emails/[id]/attachments', () => {
  it('requires inbox_ops.proposals.view and documents the response schema', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['inbox_ops.proposals.view'] })
    expect(openApi.methods.GET?.responses?.[0]).toMatchObject({ status: 200, schema: inboxEmailAttachmentListResponseSchema })
  })

  it('lists the ledger in attachment order without inline decorations or extracted text', async () => {
    const email = db.addEmail({ attachmentsStatus: 'completed' })
    db.addPart(email.id, 'logo', { status: 'skipped', reason: 'inline_decoration', disposition: 'inline', fileName: 'logo.png' })
    db.addPart(email.id, 'offer', {
      status: 'stored',
      attachmentId: STORED_ATTACHMENT_ID,
      mimeType: 'application/pdf',
      sizeBytes: 1200,
      extractedText: 'secret mail content',
    })
    db.addPart(email.id, 'tool', { status: 'skipped', reason: 'dangerous_executable', declaredMimeType: 'application/x-msdownload', fileName: 'tool.exe' })
    db.addPart(email.id, 'later', { status: 'pending', declaredMimeType: 'text/csv', fileName: 'later.csv' })
    db.addPart(email.id, 'removed', { status: 'pending', deletedAt: new Date() })

    const response = await GET(request(email.id))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(inboxEmailAttachmentListResponseSchema.parse(body)).toEqual(body)
    expect(body.items.map((item: { partKey: string }) => item.partKey)).toEqual(['resend:offer', 'resend:tool', 'resend:later'])
    expect(body.items[0]).toEqual({
      id: expect.any(String),
      partKey: 'resend:offer',
      fileName: 'offer.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1200,
      disposition: 'attachment',
      status: 'stored',
      reason: null,
      attachmentId: STORED_ATTACHMENT_ID,
      url: `/api/attachments/file/${STORED_ATTACHMENT_ID}`,
    })
    expect(body.items[1]).toMatchObject({ status: 'skipped', reason: 'dangerous_executable', mimeType: 'application/x-msdownload', url: null })
    expect(body.items[2]).toMatchObject({ status: 'pending', reason: null, mimeType: 'text/csv', attachmentId: null, url: null })
    expect(JSON.stringify(body)).not.toContain('secret mail content')
  })

  it('loads only the returned ledger columns and only the id of the email', async () => {
    const email = db.addEmail({ attachmentsStatus: 'completed' })
    db.addPart(email.id, 'offer', { status: 'stored', attachmentId: STORED_ATTACHMENT_ID, extractedText: 'secret mail content' })

    const response = await GET(request(email.id))

    expect(response.status).toBe(200)
    const emailFind = db.finds.find((call) => call.entity === InboxEmail)
    expect(emailFind?.options?.fields).toEqual(['id'])
    const ledgerFind = db.finds.find((call) => call.entity === InboxEmailAttachment)
    expect(ledgerFind?.options?.fields).toEqual([...INBOX_EMAIL_ATTACHMENT_LIST_FIELDS])
    expect(ledgerFind?.options?.fields).not.toContain('extractedText')
  })

  it('returns an empty list for an email without attachments', async () => {
    const email = db.addEmail({ attachmentsStatus: null })

    const response = await GET(request(email.id))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
  })

  it('answers 404 for a missing, soft-deleted or other-organization email and an invalid id', async () => {
    const deleted = db.addEmail({ deletedAt: new Date() })
    db.addPart(deleted.id, 'offer', { status: 'stored', attachmentId: STORED_ATTACHMENT_ID })
    const foreign = db.addEmail({ organizationId: OTHER_ORG_ID })
    db.addPart(foreign.id, 'offer', { organizationId: OTHER_ORG_ID })

    for (const id of [deleted.id, foreign.id, '7a1e4b6c-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const response = await GET(request(id))
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'Email not found' })
    }
  })

  it('scopes the ledger rows to the caller\'s organization', async () => {
    const email = db.addEmail()
    db.addPart(email.id, 'own')
    db.addPart(email.id, 'planted', { organizationId: OTHER_ORG_ID })

    const response = await GET(request(email.id))

    const body = await response.json()
    expect(body.items.map((item: { partKey: string }) => item.partKey)).toEqual(['resend:own'])
  })

  it('answers 401 without an authenticated organization', async () => {
    mockGetAuth.mockResolvedValue(null)

    const response = await GET(request(db.addEmail().id))

    expect(response.status).toBe(401)
  })
})
