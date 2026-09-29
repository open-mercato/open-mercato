import { DocumentVersion } from '../data/entities'

const mockResolveDocumentsContext = jest.fn()
const mockResolveDocumentCapabilityProjection = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockResolveUserLabels = jest.fn()

jest.mock('../api/_shared', () => ({
  assertDocumentNotArchived: jest.fn(async () => undefined),
  handleDocumentsRouteError: (error: unknown) => Response.json(
    { error: error instanceof Error ? error.message : 'failed' },
    { status: 500 },
  ),
  resolveDocumentCapabilityProjection: (...args: unknown[]) => (
    mockResolveDocumentCapabilityProjection(...args)
  ),
  resolveDocumentsContext: (...args: unknown[]) => mockResolveDocumentsContext(...args),
  routeErrorSchema: {},
  withDocumentsContextErrors: (doc: unknown) => doc,
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('../lib/userLabels', () => ({
  resolveUserLabels: (...args: unknown[]) => mockResolveUserLabels(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

jest.mock('../lib/versionContent', () => ({
  materializeDocumentVersionPreview: () => '<p>Historical content</p>',
}))

import { GET } from '../api/[id]/versions/[versionId]/route'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const documentId = '33333333-3333-4333-8333-333333333333'
const actorUserId = '44444444-4444-4444-8444-444444444444'
const versionId = '55555555-5555-4555-8555-555555555555'

describe('document version detail display labels', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveDocumentsContext.mockResolvedValue({
      em: {}, tenantId, organizationId, auth: { sub: actorUserId },
    })
    mockResolveDocumentCapabilityProjection.mockResolvedValue({
      capabilities: { canView: true },
    })
    mockResolveUserLabels.mockResolvedValue(new Map([
      [actorUserId, { label: 'Ada Lovelace', secondary: null }],
    ]))
  })

  it('sanitizes a raw UUID-bearing legacy label in the preview API', async () => {
    mockFindOneWithDecryption.mockResolvedValue(Object.assign(new DocumentVersion(), {
      id: versionId,
      tenantId,
      organizationId,
      documentId,
      label: 'Legacy 123e4567-e89b-12d3-a456-426614174000 and 01890f47-e2ab-7cc0-98c9-a72f8b123456',
      createdByUserId: actorUserId,
      createdAt: new Date('2026-07-10T12:00:00.000Z'),
      yjsSnapshot: Buffer.alloc(0),
      contentHtml: '<p>Historical content</p>',
    }))

    const response = await GET(
      new Request(`http://localhost/api/documents/${documentId}/versions/${versionId}`),
      { params: Promise.resolve({ id: documentId, versionId }) },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      id: versionId,
      label: null,
      creatorLabel: 'Ada Lovelace',
      createdAt: '2026-07-10T12:00:00.000Z',
      contentHtml: '<p>Historical content</p>',
    })
  })
})
