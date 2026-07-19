import { DocumentEntityLink } from '../data/entities'
import { DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT } from '../lib/resourceLimits'

const mockResolveDocumentsContext = jest.fn()
const mockAssertTier = jest.fn()
const mockFindDocumentEntityLinks = jest.fn()
const mockIsDocumentEntityRegistryModuleEnabled = jest.fn()
const mockResolveDocumentsCommandBus = jest.fn()
const mockGetVisibleDocumentPage = jest.fn()
const mockVerifyEntityRegistryTargetAccess = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

jest.mock('../api/_shared', () => {
  const actual = jest.requireActual('../api/_shared')
  return {
    ...actual,
    assertDocumentNotArchived: async () => undefined,
    resolveDocumentsContext: (...args: unknown[]) => mockResolveDocumentsContext(...args),
    handleDocumentsRouteError: (error: unknown) => {
      const candidate = error as { status?: unknown; body?: unknown }
      const status = typeof candidate?.status === 'number' ? candidate.status : 500
      const body = candidate?.body && typeof candidate.body === 'object'
        ? candidate.body
        : { error: 'internal' }
      return Response.json(body, { status })
    },
    hasDocumentsFeature: () => true,
  }
})

jest.mock('../api/_commands', () => ({
  attachDocumentsOperationMetadata: (response: Response) => response,
  buildDocumentsCommandRuntimeContext: jest.fn(),
  resolveDocumentsCommandBus: (...args: unknown[]) => mockResolveDocumentsCommandBus(...args),
}))

jest.mock('../lib/permissions', () => ({
  assertTier: (...args: unknown[]) => mockAssertTier(...args),
}))

jest.mock('../lib/entityLinks', () => {
  const actual = jest.requireActual('../lib/entityLinks')
  return {
    ...actual,
    findDocumentEntityLinks: (...args: unknown[]) => mockFindDocumentEntityLinks(...args),
  }
})

jest.mock('../lib/entityRegistryAvailability.server', () => ({
  isDocumentEntityRegistryModuleEnabled: (...args: unknown[]) => (
    mockIsDocumentEntityRegistryModuleEnabled(...args)
  ),
}))

jest.mock('../lib/visibility', () => ({
  getVisibleDocumentPage: (...args: unknown[]) => mockGetVisibleDocumentPage(...args),
}))

jest.mock('../lib/entityRegistry.server', () => ({
  verifyEntityRegistryTargetAccess: (...args: unknown[]) => (
    mockVerifyEntityRegistryTargetAccess(...args)
  ),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const LINK_ID = '55555555-5555-4555-8555-555555555555'
const PRODUCT_ID = '66666666-6666-4666-8666-666666666666'
const NOW = new Date('2026-07-11T10:00:00.000Z')

function context() {
  return {
    em: {},
    container: { resolve: jest.fn() },
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
      isSuperAdmin: true,
      features: ['*', 'catalog.products.view'],
      roleIds: [],
    },
  }
}

function productLink(overrides: Partial<DocumentEntityLink> = {}): DocumentEntityLink {
  return Object.assign(new DocumentEntityLink(), {
    id: LINK_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    documentId: DOCUMENT_ID,
    productId: PRODUCT_ID,
    labelSnapshot: 'Atlas Runner legacy',
    hrefSnapshot: `/legacy/products/${PRODUCT_ID}`,
    source: 'related-panel',
    createdByUserId: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  }, overrides)
}

describe('Documents API peer-module availability gates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveDocumentsContext.mockResolvedValue(context())
    mockAssertTier.mockResolvedValue('owner')
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(false)
    mockVerifyEntityRegistryTargetAccess.mockResolvedValue({ id: PRODUCT_ID })
    mockGetVisibleDocumentPage.mockResolvedValue({ rows: [], total: 0 })
  })

  it('documents the aggregate-cap response for both link list and create routes', async () => {
    const { openApi } = await import('../api/[id]/links/route')
    expect(openApi.methods.GET?.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 413 }),
    ]))
    expect(openApi.methods.POST?.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 413 }),
    ]))
  })

  it('redacts an existing link when its peer module is disabled despite wildcard grants', async () => {
    mockFindDocumentEntityLinks.mockResolvedValue([productLink()])
    const { GET } = await import('../api/[id]/links/route')

    const response = await GET(
      new Request(`http://localhost/api/documents/${DOCUMENT_ID}/links`),
      { params: { id: DOCUMENT_ID } },
    )
    const body = await response.json() as { items: Array<Record<string, unknown>> }

    expect(response.status).toBe(200)
    expect(body.items).toEqual([expect.objectContaining({
      id: LINK_ID,
      entityType: 'product',
      entityId: null,
      label: 'Restricted record',
      href: null,
      canOpen: false,
    })])
    expect(JSON.stringify(body)).not.toContain(PRODUCT_ID)
    expect(mockVerifyEntityRegistryTargetAccess).not.toHaveBeenCalled()
  })

  it('returns only the exact verifier result when the peer target is still accessible', async () => {
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(true)
    mockFindDocumentEntityLinks.mockResolvedValue([productLink()])
    mockVerifyEntityRegistryTargetAccess.mockResolvedValue({
      id: PRODUCT_ID,
      label: 'Atlas Runner current',
      href: `/backend/catalog/products/${PRODUCT_ID}`,
      values: {},
    })
    const { GET } = await import('../api/[id]/links/route')
    const request = new Request(`http://localhost/api/documents/${DOCUMENT_ID}/links`, {
      headers: { authorization: 'Bearer caller-token' },
    })

    const response = await GET(request, { params: { id: DOCUMENT_ID } })
    const body = await response.json() as { items: Array<Record<string, unknown>> }

    expect(response.status).toBe(200)
    expect(mockVerifyEntityRegistryTargetAccess).toHaveBeenCalledWith(request, {
      entityType: 'product',
      entityId: PRODUCT_ID,
    })
    expect(body.items).toEqual([{
      id: LINK_ID,
      entityType: 'product',
      entityId: PRODUCT_ID,
      label: 'Atlas Runner current',
      href: `/backend/catalog/products/${PRODUCT_ID}`,
      canOpen: true,
      source: 'related-panel',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    }])
    expect(JSON.stringify(body)).not.toContain('Atlas Runner legacy')
    expect(JSON.stringify(body)).not.toContain('/legacy/products/')
  })

  it.each([403, 404, 503])(
    'redacts a persisted link without exposing stale target data when verification returns %s',
    async (status) => {
      mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(true)
      mockFindDocumentEntityLinks.mockResolvedValue([productLink()])
      mockVerifyEntityRegistryTargetAccess.mockRejectedValue(
        Object.assign(new Error(`peer returned ${status}`), { status }),
      )
      const { GET } = await import('../api/[id]/links/route')

      const response = await GET(
        new Request(`http://localhost/api/documents/${DOCUMENT_ID}/links`),
        { params: { id: DOCUMENT_ID } },
      )
      const body = await response.json() as { items: Array<Record<string, unknown>> }

      expect(response.status).toBe(200)
      expect(body.items).toEqual([{
        id: LINK_ID,
        entityType: 'product',
        entityId: null,
        label: 'Restricted record',
        href: null,
        canOpen: false,
        source: 'related-panel',
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      }])
      expect(JSON.stringify(body)).not.toContain(PRODUCT_ID)
      expect(JSON.stringify(body)).not.toContain('Atlas Runner legacy')
      expect(JSON.stringify(body)).not.toContain('/legacy/products/')
    },
  )

  it('deduplicates exact targets and caps concurrent peer verification', async () => {
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(true)
    const uniqueUuid = (value: number) => `70000000-0000-4000-8000-${String(value).padStart(12, '0')}`
    const links = Array.from({ length: 8 }, (_, index) => productLink({
      id: uniqueUuid(index + 1),
      productId: uniqueUuid(index < 2 ? 100 : index + 100),
    }))
    mockFindDocumentEntityLinks.mockResolvedValue(links)
    let active = 0
    let maxActive = 0
    mockVerifyEntityRegistryTargetAccess.mockImplementation(async (
      _request: Request,
      input: { entityId: string },
    ) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active -= 1
      return {
        id: input.entityId,
        label: 'Current product',
        href: `/backend/catalog/products/${input.entityId}`,
        values: {},
      }
    })
    const { GET } = await import('../api/[id]/links/route')

    const response = await GET(
      new Request(`http://localhost/api/documents/${DOCUMENT_ID}/links`),
      { params: { id: DOCUMENT_ID } },
    )

    expect(response.status).toBe(200)
    expect(mockVerifyEntityRegistryTargetAccess).toHaveBeenCalledTimes(7)
    expect(maxActive).toBeLessThanOrEqual(4)
  })

  it('rejects an over-limit link collection before starting peer verification', async () => {
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(true)
    mockFindDocumentEntityLinks.mockResolvedValue(Array.from(
      { length: DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT + 1 },
      (_, index) => productLink({ id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}` }),
    ))
    const { GET } = await import('../api/[id]/links/route')

    const response = await GET(
      new Request(`http://localhost/api/documents/${DOCUMENT_ID}/links`),
      { params: { id: DOCUMENT_ID } },
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({ error: 'documents.links.limitExceeded' })
    expect(mockVerifyEntityRegistryTargetAccess).not.toHaveBeenCalled()
  })

  it('rejects direct link creation before command dispatch when the peer module is disabled', async () => {
    const execute = jest.fn()
    mockResolveDocumentsCommandBus.mockReturnValue({ execute })
    const { POST } = await import('../api/[id]/links/route')

    const response = await POST(
      new Request(`http://localhost/api/documents/${DOCUMENT_ID}/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          entityType: 'product',
          entityId: PRODUCT_ID,
          label: 'Atlas Runner',
          href: `/backend/catalog/products/${PRODUCT_ID}`,
          source: 'related-panel',
        }),
      }),
      { params: { id: DOCUMENT_ID } },
    )

    expect(response.status).toBe(403)
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects relation-filtered document lists before querying when the peer module is disabled', async () => {
    const { GET } = await import('../api/route')
    const response = await GET(new Request(
      `http://localhost/api/documents?entityType=product&entityId=${PRODUCT_ID}`,
    ))

    expect(response.status).toBe(403)
    expect(mockVerifyEntityRegistryTargetAccess).not.toHaveBeenCalled()
    expect(mockGetVisibleDocumentPage).not.toHaveBeenCalled()
  })

  it('rejects a relation filter before querying when the exact peer record is restricted or missing', async () => {
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(true)
    mockVerifyEntityRegistryTargetAccess.mockRejectedValue({
      status: 403,
      body: { error: 'documents.links.targetRestricted' },
    })
    const { GET } = await import('../api/route')

    const response = await GET(new Request(
      `http://localhost/api/documents?entityType=product&entityId=${PRODUCT_ID}`,
    ))

    expect(response.status).toBe(403)
    expect(mockGetVisibleDocumentPage).not.toHaveBeenCalled()
  })

  it('filters only by the peer identity returned from the authenticated exact-record lookup', async () => {
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(true)
    mockVerifyEntityRegistryTargetAccess.mockResolvedValue({ id: PRODUCT_ID })
    const { GET } = await import('../api/route')
    const request = new Request(
      `http://localhost/api/documents?entityType=product&entityId=${PRODUCT_ID}`,
      { headers: { authorization: 'Bearer caller-token' } },
    )

    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(mockVerifyEntityRegistryTargetAccess).toHaveBeenCalledWith(request, {
      entityType: 'product',
      entityId: PRODUCT_ID,
    })
    expect(mockGetVisibleDocumentPage).toHaveBeenCalledWith(expect.objectContaining({
      relationFilter: { entityType: 'product', entityId: PRODUCT_ID },
    }))
  })
})
