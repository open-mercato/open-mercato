const mockResolveDocumentsContext = jest.fn()
const mockAssertTier = jest.fn()
const mockValidateMutationGuard = jest.fn()
const mockRunMutationGuardAfterSuccess = jest.fn()
const mockCommandExecute = jest.fn()
const mockAttachOperationMetadata = jest.fn()

jest.mock('../lib/permissions', () => ({
  assertTier: (...args: unknown[]) => mockAssertTier(...args),
}))

jest.mock('../api/_shared', () => ({
  assertDocumentNotArchived: jest.fn(async () => undefined),
  handleDocumentsRouteError: (error: unknown) => Response.json(
    { error: error instanceof Error ? error.message : 'failed' },
    { status: 500 },
  ),
  readBody: async () => ({ label: 'Before review' }),
  resolveDocumentsContext: (...args: unknown[]) => mockResolveDocumentsContext(...args),
  routeErrorSchema: {},
  runMutationGuardAfterSuccess: (...args: unknown[]) => mockRunMutationGuardAfterSuccess(...args),
  validateMutationGuard: (...args: unknown[]) => mockValidateMutationGuard(...args),
}))

jest.mock('../api/_commands', () => ({
  attachDocumentsOperationMetadata: (...args: unknown[]) => mockAttachOperationMetadata(...args),
  buildDocumentsCommandRuntimeContext: () => ({ runtime: true }),
  resolveDocumentsCommandBus: () => ({ execute: mockCommandExecute }),
}))

import { POST } from '../api/[id]/versions/route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const documentId = '44444444-4444-4444-8444-444444444444'
const versionId = '55555555-5555-4555-8555-555555555555'

describe('document version create command route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const em = {
      create: jest.fn(),
      persist: jest.fn(),
      flush: jest.fn(),
    }
    mockResolveDocumentsContext.mockResolvedValue({
      em,
      container: {},
      tenantId,
      organizationId,
      auth: {
        sub: actorUserId,
        userId: actorUserId,
        tenantId,
        orgId: organizationId,
        features: ['documents.edit'],
      },
    })
    mockValidateMutationGuard.mockResolvedValue({ ok: true })
    mockRunMutationGuardAfterSuccess.mockResolvedValue(undefined)
    const logEntry = {
      id: '66666666-6666-4666-8666-666666666666',
      undoToken: null,
      commandId: 'documents.version.create',
    }
    mockCommandExecute.mockResolvedValue({
      result: {
        id: versionId,
        label: 'Before review',
        createdByUserId: actorUserId,
        createdAt: '2026-07-10T12:00:00.000Z',
        after: { id: versionId },
      },
      logEntry,
    })
    mockAttachOperationMetadata.mockImplementation((response: Response, log: { undoToken?: string | null }) => {
      if (log.undoToken) response.headers.set('x-test-operation', 'attached')
      return response
    })
  })

  it('dispatches a stable-id command without advertising undo metadata', async () => {
    const request = new Request(`http://localhost/api/documents/${documentId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ label: 'Before review' }),
      headers: { 'content-type': 'application/json' },
    })
    const response = await POST(request, { params: Promise.resolve({ id: documentId }) })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(201)
    expect(response.headers.get('x-test-operation')).toBeNull()
    expect(body).toEqual({
      id: versionId,
      label: 'Before review',
      createdByUserId: actorUserId,
      createdAt: '2026-07-10T12:00:00.000Z',
    })
    expect(mockCommandExecute).toHaveBeenCalledWith(
      'documents.version.create',
      {
        input: {
          label: 'Before review',
          documentId,
          versionId: expect.any(String),
          tenantId,
          organizationId,
        },
        ctx: { runtime: true },
      },
    )
    expect(mockRunMutationGuardAfterSuccess).toHaveBeenCalledTimes(1)
    expect(mockAttachOperationMetadata).toHaveBeenCalledWith(
      expect.any(Response),
      expect.objectContaining({ commandId: 'documents.version.create' }),
      { resourceKind: 'documents:document_version', resourceId: versionId },
    )

    const em = (await mockResolveDocumentsContext.mock.results[0]!.value).em
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not echo an unsafe legacy command result label into the API response', async () => {
    mockCommandExecute.mockResolvedValueOnce({
      result: {
        id: versionId,
        label: 'Legacy 123e4567-e89b-12d3-a456-426614174000',
        createdByUserId: actorUserId,
        createdAt: '2026-07-10T12:00:00.000Z',
      },
      logEntry: {
        id: '66666666-6666-4666-8666-666666666666',
        undoToken: null,
        commandId: 'documents.version.create',
      },
    })

    const response = await POST(new Request(
      `http://localhost/api/documents/${documentId}/versions`,
      { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
    ), { params: Promise.resolve({ id: documentId }) })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ id: versionId, label: null })
  })
})
