import { DocumentVersion } from '../data/entities'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const documentId = '33333333-3333-4333-8333-333333333333'
const actorUserId = '44444444-4444-4444-8444-444444444444'
const versionId = '55555555-5555-4555-8555-555555555555'

const mockResolveDocumentsContext = jest.fn()
const mockAssertTier = jest.fn()
const mockFindAndCountWithDecryption = jest.fn()
const mockResolveUserLabels = jest.fn()

jest.mock('../api/_shared', () => ({
  assertDocumentNotArchived: jest.fn(async () => undefined),
  handleDocumentsRouteError: (error: unknown) => Response.json(
    { error: error instanceof Error ? error.message : 'failed' },
    { status: 500 },
  ),
  readBody: jest.fn(),
  resolveDocumentsContext: (...args: unknown[]) => mockResolveDocumentsContext(...args),
  routeErrorSchema: {},
  runMutationGuardAfterSuccess: jest.fn(),
  validateMutationGuard: jest.fn(),
}))

jest.mock('../lib/permissions', () => ({
  assertTier: (...args: unknown[]) => mockAssertTier(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCountWithDecryption(...args),
}))

jest.mock('../lib/userLabels', () => ({
  resolveUserLabels: (...args: unknown[]) => mockResolveUserLabels(...args),
}))

import { GET, openApi, versionListQuerySchema } from '../api/[id]/versions/route'

describe('document version metadata pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveDocumentsContext.mockResolvedValue({
      em: {}, tenantId, organizationId, auth: { sub: actorUserId },
    })
    mockAssertTier.mockResolvedValue('owner')
    mockFindAndCountWithDecryption.mockResolvedValue([[
      Object.assign(new DocumentVersion(), {
        id: versionId,
        label: 'Review point',
        createdByUserId: actorUserId,
        createdAt: new Date('2026-07-10T12:00:00.000Z'),
      }),
    ], 7])
    mockResolveUserLabels.mockResolvedValue(new Map([
      [actorUserId, { label: 'Ada Lovelace', secondary: null }],
    ]))
  })

  it('projects only metadata fields and returns additive page totals', async () => {
    const response = await GET(
      new Request(`http://localhost/api/documents/${documentId}/versions?page=2&pageSize=3`),
      { params: Promise.resolve({ id: documentId }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [{
        id: versionId,
        label: 'Review point',
        createdByUserId: actorUserId,
        createdByLabel: 'Ada Lovelace',
        createdAt: '2026-07-10T12:00:00.000Z',
      }],
      page: 2,
      pageSize: 3,
      total: 7,
      totalPages: 3,
    })
    expect(mockFindAndCountWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      DocumentVersion,
      { documentId, tenantId, organizationId },
      expect.objectContaining({
        fields: ['id', 'label', 'createdByUserId', 'createdAt'],
        limit: 3,
        offset: 3,
      }),
      { tenantId, organizationId },
    )
    const options = mockFindAndCountWithDecryption.mock.calls[0]?.[3]
    expect(options.fields).not.toEqual(expect.arrayContaining(['yjsSnapshot', 'contentHtml']))
    expect(openApi.methods.GET?.query).toBe(versionListQuerySchema)
  })

  it('bounds requested metadata pages to the retained-history maximum', () => {
    expect(versionListQuerySchema.safeParse({ page: '1', pageSize: '101' }).success).toBe(false)
  })

  it('sanitizes UUID-bearing labels already persisted by legacy versions', async () => {
    mockFindAndCountWithDecryption.mockResolvedValue([[
      Object.assign(new DocumentVersion(), {
        id: versionId,
        label: 'Review 123e4567-e89b-12d3-a456-426614174000 vs 01890f47-e2ab-7cc0-98c9-a72f8b123456',
        createdByUserId: actorUserId,
        createdAt: new Date('2026-07-10T12:00:00.000Z'),
      }),
    ], 1])

    const response = await GET(
      new Request(`http://localhost/api/documents/${documentId}/versions`),
      { params: Promise.resolve({ id: documentId }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: versionId, label: null }],
    })
  })
})
