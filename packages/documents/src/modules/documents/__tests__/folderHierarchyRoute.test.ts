import { NextResponse } from 'next/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const folderId = '44444444-4444-4444-8444-444444444444'
const parentFolderId = '55555555-5555-4555-8555-555555555555'

const mockGetFolderPlacementIssue = jest.fn()
const mockValidateMutationGuard = jest.fn(async () => null)
const mockCommandExecute = jest.fn()

const em = {
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
    ...data,
    updatedAt: new Date('2026-07-10T10:00:00.000Z'),
  })),
  persist: jest.fn(),
  flush: jest.fn(async () => undefined),
}

const routeContext = {
  em,
  tenantId,
  organizationId,
  auth: { sub: userId, userId, tenantId, orgId: organizationId },
  container: {},
}

jest.mock('../lib/visibility', () => ({
  getFolderPlacementIssue: (...args: unknown[]) => mockGetFolderPlacementIssue(...args),
  getVisibleFolders: jest.fn(async () => []),
  hasActiveFolderContents: jest.fn(async () => false),
}))

jest.mock('../api/_shared', () => ({
  assertDocumentNotArchived: jest.fn(async () => undefined),
  resolveDocumentsContext: jest.fn(async () => routeContext),
  readBody: jest.fn(async (request: Request) => request.json()),
  resolveActorUserId: jest.fn(() => userId),
  validateMutationGuard: (...args: unknown[]) => mockValidateMutationGuard(...args),
  runMutationGuardAfterSuccess: jest.fn(async () => undefined),
  hasDocumentsFeature: jest.fn(() => false),
  serializeFolder: jest.fn((folder: Record<string, unknown>) => folder),
  routeErrorSchema: {},
  handleDocumentsRouteError: (error: unknown) => {
    if (error instanceof CrudHttpError) {
      return NextResponse.json(error.body, { status: error.status })
    }
    return NextResponse.json({ error: 'Unexpected error' }, { status: 500 })
  },
}))

jest.mock('../api/_commands', () => ({
  attachDocumentsOperationMetadata: (response: Response) => response,
  buildDocumentsCommandRuntimeContext: () => ({ runtime: true }),
  resolveDocumentsCommandBus: () => ({ execute: mockCommandExecute }),
}))

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLock: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { POST, PUT } from '../api/folders/route'

function jsonRequest(method: 'POST' | 'PUT', body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/documents/folders', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('folder route hierarchy contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetFolderPlacementIssue.mockResolvedValue(null)
  })

  it('surfaces a command-level create placement rejection without persisting in the route', async () => {
    mockCommandExecute.mockRejectedValueOnce(new CrudHttpError(400, {
      error: 'documents.folders.error.invalidPlacement',
    }))

    const response = await POST(jsonRequest('POST', {
      name: 'Too deep',
      parentFolderId,
    }))

    expect(response.status).toBe(400)
    expect(mockCommandExecute).toHaveBeenCalledWith(
      'documents.folder.create',
      {
        input: {
          name: 'Too deep',
          parentFolderId,
          tenantId,
          organizationId,
          folderId: expect.any(String),
        },
        ctx: { runtime: true },
      },
    )
    expect(mockGetFolderPlacementIssue).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('surfaces a command-level move placement rejection without flushing in the route', async () => {
    mockCommandExecute.mockRejectedValueOnce(new CrudHttpError(400, {
      error: 'documents.folders.error.invalidPlacement',
    }))

    const response = await PUT(jsonRequest('PUT', {
      id: folderId,
      parentFolderId,
    }))

    expect(response.status).toBe(400)
    expect(mockCommandExecute).toHaveBeenCalledWith(
      'documents.folder.update',
      {
        input: { id: folderId, parentFolderId, tenantId, organizationId },
        ctx: { runtime: true },
      },
    )
    expect(mockGetFolderPlacementIssue).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })
})
