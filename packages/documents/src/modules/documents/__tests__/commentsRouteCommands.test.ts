import { Document, DocumentComment } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const COMMENT_ID = '55555555-5555-4555-8555-555555555555'
const UPDATED_AT = '2026-07-10T10:00:00.000Z'

const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const commandExecute = jest.fn()

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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.findOne(...args),
  findWithDecryption: (em: { find: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.find(...args),
}))

type CommentsRoute = typeof import('../api/[id]/comments/route')

let POST: CommentsRoute['POST']
let PATCH: CommentsRoute['PATCH']

const comment = {
  id: COMMENT_ID,
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
  documentId: DOCUMENT_ID,
  parentCommentId: null,
  authorUserId: USER_ID,
  body: 'Review this',
  anchor: null,
  mentions: null,
  resolvedAt: null,
  resolvedByUserId: null,
  deletedAt: null,
  createdAt: new Date(UPDATED_AT),
  updatedAt: new Date(UPDATED_AT),
}

const em = {
  findOne: jest.fn(async (entity: unknown) => {
    if (entity === Document) {
      return {
        id: DOCUMENT_ID,
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        ownerUserId: USER_ID,
        deletedAt: null,
      }
    }
    if (entity === DocumentComment) return comment
    return null
  }),
  find: jest.fn(async () => []),
}

const rbacService = {
  loadAcl: jest.fn(async () => ({
    isSuperAdmin: false,
    features: ['documents.view'],
    organizations: null,
  })),
}

const commandBus = { execute: (...args: unknown[]) => commandExecute(...args) }
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbacService
    if (name === 'commandBus') return commandBus
    return undefined
  }),
}

function request(method: 'POST' | 'PATCH', body: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/documents/${DOCUMENT_ID}/comments`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: DOCUMENT_ID }) }

beforeAll(async () => {
  const route = await import('../api/[id]/comments/route')
  POST = route.POST
  PATCH = route.PATCH
})

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateRequestContainer.mockResolvedValue(container)
  mockGetAuthFromRequest.mockResolvedValue({
    sub: USER_ID,
    userId: USER_ID,
    tenantId: TENANT_ID,
    orgId: ORGANIZATION_ID,
    roles: [],
  })
  mockResolveOrganizationScopeForRequest.mockResolvedValue({
    selectedId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
  })
  commandExecute.mockImplementation(async (commandId: string) => ({
    result: commandId === 'documents.comment.create'
      ? { id: COMMENT_ID, updatedAt: UPDATED_AT }
      : {
          id: COMMENT_ID,
          resolvedAt: UPDATED_AT,
          resolvedByUserId: USER_ID,
          updatedAt: UPDATED_AT,
        },
    logEntry: null,
  }))
})

describe('documents comments command routes', () => {
  it('dispatches create with stable comment and mention-share identities', async () => {
    const mentionedUserId = '66666666-6666-4666-8666-666666666666'
    const response = await POST(request('POST', {
      body: `Please review @[${mentionedUserId}]`,
      mentions: [{ userId: mentionedUserId }],
      grantAccessTo: [mentionedUserId],
    }), context)

    expect(response.status).toBe(201)
    expect(commandExecute).toHaveBeenCalledWith(
      'documents.comment.create',
      expect.objectContaining({ input: expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
        commentId: expect.any(String),
        actorUserId: USER_ID,
        grantShares: [{ userId: mentionedUserId, shareId: expect.any(String) }],
      }) }),
    )
  })

  it('dispatches resolve with the route-validated optimistic version', async () => {
    const response = await PATCH(request('PATCH', { id: COMMENT_ID, resolved: true }), context)

    expect(response.status).toBe(200)
    expect(commandExecute).toHaveBeenCalledWith(
      'documents.comment.resolve',
      expect.objectContaining({ input: expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
        documentId: DOCUMENT_ID,
        actorUserId: USER_ID,
        expectedUpdatedAt: UPDATED_AT,
        comment: { id: COMMENT_ID, resolved: true },
      }) }),
    )
  })
})
