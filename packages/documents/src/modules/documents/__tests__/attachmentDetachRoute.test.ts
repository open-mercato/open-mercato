import { Document, DocumentAttachment } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555'
const ATTACHMENT_ID = '66666666-6666-4666-8666-666666666666'

const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('../lib/platformServices', () => ({
  ...jest.requireActual('../lib/platformServices'),
  resolveOrganizationScopeService: () => ({
    resolve: jest.fn(), resolveFresh: jest.fn(),
    resolveForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
  }),
}))

type AttachmentDetailRoute = typeof import('../api/[id]/attachments/[attachmentId]/route')

let DELETE: AttachmentDetailRoute['DELETE']
let features: string[]
let attachmentRecord: { id: string; updatedAt: Date; deletedAt: Date | null } | null
let em: { findOne: jest.Mock; find: jest.Mock; flush: jest.Mock }
const executeCommand = jest.fn(async () => ({ result: { id: ATTACHMENT_ID }, logEntry: null }))

const rbacService = {
  loadAcl: jest.fn(async () => ({
    isSuperAdmin: false,
    features,
    organizations: null,
  })),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbacService
    if (name === 'commandBus') return { execute: executeCommand }
    return undefined
  }),
}

beforeAll(async () => {
  const route = await import('../api/[id]/attachments/[attachmentId]/route')
  DELETE = route.DELETE
})

beforeEach(() => {
  jest.clearAllMocks()
  features = ['documents.view', 'documents.edit']
  attachmentRecord = { id: ATTACHMENT_ID, updatedAt: new Date('2026-07-12T10:00:00.000Z'), deletedAt: null }
  em = {
    findOne: jest.fn(async (entity: unknown) => {
      if (entity === DocumentAttachment) return attachmentRecord
      if (entity !== Document) return null
      return {
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        ownerUserId: USER_ID,
        deletedAt: null,
      }
    }),
    find: jest.fn(async () => []),
    flush: jest.fn(async () => undefined),
  }
  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    userId: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORGANIZATION_ID,
    roles: [],
    features: [],
  })
  mockResolveOrganizationScopeForRequest.mockResolvedValue({
    selectedId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
  })
})

function request(): Request {
  return new Request(
    `http://localhost/api/documents/${DOCUMENT_ID}/attachments/${ATTACHMENT_ID}`,
    { method: 'DELETE' },
  )
}

function context() {
  return { params: Promise.resolve({ id: DOCUMENT_ID, attachmentId: ATTACHMENT_ID }) }
}

describe('document attachment detach', () => {
  it('routes permanent deletion through the audited command', async () => {
    const response = await DELETE(request(), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(executeCommand).toHaveBeenCalledWith('documents.attachment.delete', expect.objectContaining({
      input: {
        documentId: DOCUMENT_ID,
        attachmentId: ATTACHMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
      },
    }))
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('returns 404 when the association is already detached', async () => {
    attachmentRecord = null

    const response = await DELETE(request(), context())

    expect(response.status).toBe(404)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects a caller without documents.edit', async () => {
    features = ['documents.view']

    const response = await DELETE(request(), context())

    expect(response.status).toBe(403)
    expect(em.flush).not.toHaveBeenCalled()
  })
})
