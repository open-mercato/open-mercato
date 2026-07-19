const mockResolveDocumentsContext = jest.fn()
const mockAssertTier = jest.fn()
const mockLoadDocumentContent = jest.fn()
const mockValidateMutationGuard = jest.fn()
const mockRunMutationGuardAfterSuccess = jest.fn()
const mockHandleDocumentsRouteError = jest.fn()
const mockCommandExecute = jest.fn()
const mockAttachOperationMetadata = jest.fn()
const mockEmitDocumentsEvent = jest.fn()
const mockIndexRecordById = jest.fn()

jest.mock('../lib/permissions', () => ({
  assertTier: (...args: unknown[]) => mockAssertTier(...args),
}))

jest.mock('../lib/contentService', () => ({
  loadDocumentContent: (...args: unknown[]) => mockLoadDocumentContent(...args),
}))

jest.mock('../events', () => ({
  emitDocumentsEvent: (...args: unknown[]) => mockEmitDocumentsEvent(...args),
}))

jest.mock('../api/_shared', () => ({
  assertDocumentNotArchived: jest.fn(async () => undefined),
  handleDocumentsRouteError: (...args: unknown[]) => mockHandleDocumentsRouteError(...args),
  readBody: async (request: Request) => request.json(),
  resolveDocumentsContext: (...args: unknown[]) => mockResolveDocumentsContext(...args),
  routeErrorSchema: {},
  runMutationGuardAfterSuccess: (...args: unknown[]) => mockRunMutationGuardAfterSuccess(...args),
  serializeContent: jest.fn(),
  validateMutationGuard: (...args: unknown[]) => mockValidateMutationGuard(...args),
}))

jest.mock('../api/_commands', () => ({
  attachDocumentsOperationMetadata: (...args: unknown[]) => mockAttachOperationMetadata(...args),
  buildDocumentsCommandRuntimeContext: () => ({ runtime: true }),
  resolveDocumentsCommandBus: () => ({ execute: mockCommandExecute }),
}))

import { interceptors } from '../commands/interceptors'

type ContentRoute = typeof import('../api/[id]/content/route')

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const CONTENT_ID = '55555555-5555-4555-8555-555555555555'
const UPDATED_AT = '2026-07-10T10:00:01.000Z'

let PUT: ContentRoute['PUT']

const em = {}
const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'searchIndexer') return { indexRecordById: mockIndexRecordById }
    return undefined
  }),
}

beforeAll(async () => {
  const route = await import('../api/[id]/content/route')
  PUT = route.PUT
})

beforeEach(() => {
  jest.clearAllMocks()
  mockResolveDocumentsContext.mockResolvedValue({
    em,
    container,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      organizationId: ORGANIZATION_ID,
      features: ['documents.edit'],
      roleIds: [],
    },
  })
  mockLoadDocumentContent.mockResolvedValue({ id: CONTENT_ID })
  mockValidateMutationGuard.mockResolvedValue({ ok: true })
  mockRunMutationGuardAfterSuccess.mockResolvedValue(undefined)
  mockHandleDocumentsRouteError.mockImplementation(async (error: unknown) => Response.json(
    { error: error instanceof Error ? error.message : 'failed' },
    { status: 500 },
  ))
  mockAttachOperationMetadata.mockImplementation((response: Response) => {
    response.headers.set('x-test-operation', 'attached')
    return response
  })
})

function request(): Request {
  return new Request(`http://localhost/api/documents/${DOCUMENT_ID}/content`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-om-ext-optimistic-lock-expected-updated-at': '2026-07-10T10:00:00.000Z',
    },
    body: JSON.stringify({ contentHtml: '<p>Requested</p>', contentText: 'Requested' }),
  })
}

function context() {
  return { params: Promise.resolve({ id: DOCUMENT_ID }) }
}

describe('document content command route', () => {
  it('dispatches the stable content identity and returns operation metadata', async () => {
    const logEntry = {
      id: '66666666-6666-4666-8666-666666666666',
      undoToken: '77777777-7777-4777-8777-777777777777',
      commandId: 'documents.content.replace',
    }
    mockCommandExecute.mockResolvedValue({
      result: { id: CONTENT_ID, updatedAt: UPDATED_AT },
      logEntry,
    })

    const response = await PUT(request(), context())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, updatedAt: UPDATED_AT })
    expect(response.headers.get('x-test-operation')).toBe('attached')
    expect(mockCommandExecute).toHaveBeenCalledWith(
      'documents.content.replace',
      {
        input: {
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
          documentId: DOCUMENT_ID,
          contentId: CONTENT_ID,
          contentHtml: '<p>Requested</p>',
          contentText: 'Requested',
        },
        ctx: { runtime: true },
      },
    )
    expect(mockRunMutationGuardAfterSuccess).toHaveBeenCalledTimes(1)
    expect(mockAttachOperationMetadata).toHaveBeenCalledWith(
      expect.any(Response),
      logEntry,
      { resourceKind: 'documents:document_content', resourceId: CONTENT_ID },
    )
  })

  it('still returns success when post-log index and event projections fail', async () => {
    const projectionInterceptor = interceptors.find((entry) => (
      entry.targetCommand === 'documents.content.replace'
    ))
    expect(projectionInterceptor).toBeDefined()
    mockIndexRecordById.mockRejectedValue(new Error('index unavailable'))
    mockEmitDocumentsEvent.mockRejectedValue(new Error('events unavailable'))
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCommandExecute.mockImplementation(async (_commandId: string, options: { input: Record<string, unknown> }) => {
      const result = {
        id: CONTENT_ID,
        updatedAt: UPDATED_AT,
        projections: [
          {
            kind: 'document-index' as const,
            documentId: DOCUMENT_ID,
            tenantId: TENANT_ID,
            organizationId: ORGANIZATION_ID,
          },
          {
            kind: 'event' as const,
            eventId: 'documents.document.updated' as const,
            payload: {
              id: DOCUMENT_ID,
              documentId: DOCUMENT_ID,
              tenantId: TENANT_ID,
              organizationId: ORGANIZATION_ID,
              userId: USER_ID,
              contentEpochReset: true,
            },
          },
        ],
      }
      await projectionInterceptor!.afterExecute?.(
        options.input,
        result,
        {
          commandId: 'documents.content.replace',
          auth: { sub: USER_ID } as never,
          selectedOrganizationId: ORGANIZATION_ID,
          container: container as never,
        },
      )
      return { result, logEntry: null }
    })

    try {
      const response = await PUT(request(), context())
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ ok: true, updatedAt: UPDATED_AT })
      expect(mockIndexRecordById).toHaveBeenCalledTimes(1)
      expect(mockEmitDocumentsEvent).toHaveBeenCalledTimes(1)
      expect(mockHandleDocumentsRouteError).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
