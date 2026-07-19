import { DocumentComment } from '../data/entities'
import {
  DOCUMENTS_COMMENT_LIST_PAGE_SIZE,
  DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT,
} from '../lib/historyLimits'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const documentId = '33333333-3333-4333-8333-333333333333'
const actorUserId = '44444444-4444-4444-8444-444444444444'

const mockResolveDocumentsContext = jest.fn()
const mockAssertTier = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockResolveViewerSafeUserLabels = jest.fn()

jest.mock('../api/_shared', () => ({
  assertDocumentNotArchived: jest.fn(async () => undefined),
  handleDocumentsRouteError: (error: unknown) => Response.json(
    { error: error instanceof Error ? error.message : 'failed' },
    { status: 500 },
  ),
  readBody: jest.fn(),
  resolveActorUserId: () => actorUserId,
  resolveDocumentsContext: (...args: unknown[]) => mockResolveDocumentsContext(...args),
  routeErrorSchema: {},
  runMutationGuardAfterSuccess: jest.fn(),
  validateMutationGuard: jest.fn(),
}))

jest.mock('../lib/permissions', () => ({
  assertTier: (...args: unknown[]) => mockAssertTier(...args),
  hasTier: () => true,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('../lib/userLabels', () => ({
  resolveViewerSafeUserLabels: (...args: unknown[]) => mockResolveViewerSafeUserLabels(...args),
}))

import {
  commentListQuerySchema,
  GET,
  openApi,
  paginateNewestThreadRoots,
} from '../api/[id]/comments/route'

function comment(index: number): DocumentComment {
  return Object.assign(new DocumentComment(), {
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    tenantId,
    organizationId,
    documentId,
    parentCommentId: null,
    authorUserId: `${String(index + 10).padStart(8, '0')}-0000-4000-8000-000000000000`,
    body: `Comment ${index}`,
    anchor: null,
    mentions: [],
    resolvedAt: null,
    resolvedByUserId: null,
    createdAt: new Date(Date.UTC(2026, 0, index)),
    updatedAt: new Date(Date.UTC(2026, 0, index)),
    deletedAt: null,
  })
}

describe('document comment history pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveDocumentsContext.mockResolvedValue({
      container: {}, em: {}, tenantId, organizationId, auth: { sub: actorUserId },
    })
    mockAssertTier.mockResolvedValue('owner')
    mockFindWithDecryption.mockResolvedValue([5, 4, 3, 2, 1].map(comment))
    mockResolveViewerSafeUserLabels.mockResolvedValue(new Map())
  })

  it('returns a chronological page from the newest bounded root threads', async () => {
    const response = await GET(
      new Request(`http://localhost/api/documents/${documentId}/comments?page=2&pageSize=2`),
      { params: Promise.resolve({ id: documentId }) },
    )
    const body = await response.json() as {
      items: Array<{ body: string }>
      page: number
      pageSize: number
      total: number
      totalPages: number
      totalComments: number
      truncated: boolean
    }

    expect(response.status).toBe(200)
    expect(body.items.map((item) => item.body)).toEqual(['Comment 2', 'Comment 3'])
    expect(body).toMatchObject({
      page: 2,
      pageSize: 2,
      total: 5,
      totalPages: 3,
      totalComments: 5,
      truncated: false,
    })
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      DocumentComment,
      { documentId, tenantId, organizationId, deletedAt: null },
      expect.objectContaining({
        orderBy: { createdAt: 'DESC', id: 'DESC' },
        limit: DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT + 1,
      }),
      { tenantId, organizationId },
    )
    expect(openApi.methods.GET?.query).toBe(commentListQuerySchema)
  })

  it('returns only the viewer-safe label projection from comment history', async () => {
    const authorUserId = comment(1).authorUserId
    mockFindWithDecryption.mockResolvedValue([comment(1)])
    mockResolveViewerSafeUserLabels.mockResolvedValue(new Map([
      [authorUserId, { label: 'Ada Lovelace' }],
    ]))

    const response = await GET(
      new Request(`http://localhost/api/documents/${documentId}/comments`),
      { params: Promise.resolve({ id: documentId }) },
    )
    const body = await response.json() as {
      userLabels: Record<string, { label: string; secondary?: string | null }>
    }

    expect(response.status).toBe(200)
    expect(body.userLabels).toEqual({
      [authorUserId]: { label: 'Ada Lovelace' },
    })
    expect(body.userLabels[authorUserId]).not.toHaveProperty('secondary')
    expect(mockResolveViewerSafeUserLabels).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId, organizationId },
      [authorUserId],
    )
  })

  it('keeps each page chronological while moving backward through history', () => {
    expect(paginateNewestThreadRoots([1, 2, 3, 4, 5], 1, 2)).toEqual([4, 5])
    expect(paginateNewestThreadRoots([1, 2, 3, 4, 5], 2, 2)).toEqual([2, 3])
    expect(paginateNewestThreadRoots([1, 2, 3, 4, 5], 3, 2)).toEqual([1])
    expect(paginateNewestThreadRoots([1, 2, 3, 4, 5], 4, 2)).toEqual([])
  })

  it('clamps accepted and default list page sizes to the platform pageSize cap', () => {
    expect(DOCUMENTS_COMMENT_LIST_PAGE_SIZE).toBeLessThanOrEqual(100)
    expect(commentListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: DOCUMENTS_COMMENT_LIST_PAGE_SIZE,
    })
    expect(commentListQuerySchema.parse({
      page: '1',
      pageSize: String(DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT + 1),
    }).pageSize).toBe(DOCUMENTS_COMMENT_LIST_PAGE_SIZE)
  })
})
