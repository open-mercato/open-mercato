import { DocumentShare } from '../data/entities'
import { DOCUMENTS_MAX_LISTED_SHARES } from '../lib/constants'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'

const mockFindWithDecryption = jest.fn()
const mockResolveUserLabels = jest.fn(async () => new Map())

jest.mock('@open-mercato/shared/lib/encryption/find', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/encryption/find')
  return {
    ...actual,
    findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
  }
})

jest.mock('../lib/userLabels', () => ({
  resolveUserLabels: (...args: unknown[]) => mockResolveUserLabels(...args),
}))

jest.mock('../api/_shared', () => {
  const actual = jest.requireActual('../api/_shared')
  return {
    ...actual,
    resolveDocumentsContext: async () => ({
      container: { resolve: jest.fn(() => undefined) },
      em: {},
      auth: {
        sub: USER_ID,
        userId: USER_ID,
        tenantId: TENANT_ID,
        orgId: ORGANIZATION_ID,
        organizationId: ORGANIZATION_ID,
        features: ['documents.view', 'documents.share'],
        roleIds: [],
        resolvedRoleIds: [],
        isSuperAdmin: false,
      },
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      request: new Request('http://localhost'),
    }),
    resolveDocumentCapabilityProjection: async () => ({
      relationshipTier: 'owner',
      capabilities: { canShare: true },
    }),
  }
})

import { GET } from '../api/[id]/shares/route'

function shareRow(index: number): DocumentShare {
  const suffix = index.toString(16).padStart(12, '0')
  return Object.assign(new DocumentShare(), {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`,
    documentId: DOCUMENT_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    principalType: 'user',
    principalId: `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`,
    permission: 'viewer',
    createdByUserId: USER_ID,
    createdAt: new Date('2026-07-18T10:00:00.000Z'),
    updatedAt: new Date('2026-07-18T10:00:00.000Z'),
  })
}

function request(): Request {
  return new Request(`http://localhost/api/documents/${DOCUMENT_ID}/shares`)
}

function context() {
  return { params: Promise.resolve({ id: DOCUMENT_ID }) }
}

describe('document shares listing bounds', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveUserLabels.mockResolvedValue(new Map())
  })

  it('reads at most one row beyond the cap so the query can never fan out unbounded', async () => {
    mockFindWithDecryption.mockResolvedValue([])

    const response = await GET(request(), context())

    expect(response.status).toBe(200)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      DocumentShare,
      expect.objectContaining({ documentId: DOCUMENT_ID, deletedAt: null }),
      expect.objectContaining({ limit: DOCUMENTS_MAX_LISTED_SHARES + 1 }),
      expect.anything(),
    )
  })

  it('truncates an over-cap share list and reports it instead of serializing every row', async () => {
    const rows = Array.from({ length: DOCUMENTS_MAX_LISTED_SHARES + 1 }, (_row, index) => shareRow(index))
    mockFindWithDecryption.mockResolvedValue(rows)

    const response = await GET(request(), context())
    const body = await response.json() as { items: unknown[]; truncated: boolean }

    expect(response.status).toBe(200)
    expect(body.items).toHaveLength(DOCUMENTS_MAX_LISTED_SHARES)
    expect(body.truncated).toBe(true)
    // The principal-label fan-out must follow the truncated list, not the read.
    const labelledPrincipalIds = mockResolveUserLabels.mock.calls[0]?.[2] as string[] | undefined
    expect(labelledPrincipalIds).toHaveLength(DOCUMENTS_MAX_LISTED_SHARES)
  })

  it('reports an under-cap share list as complete', async () => {
    mockFindWithDecryption.mockResolvedValue([shareRow(1), shareRow(2)])

    const response = await GET(request(), context())
    const body = await response.json() as { items: unknown[]; truncated: boolean }

    expect(body.items).toHaveLength(2)
    expect(body.truncated).toBe(false)
  })
})
