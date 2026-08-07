import { DocumentEntityLink } from '../data/entities'

const mockResolveDocumentsContext = jest.fn()
const mockAssertTier = jest.fn()
const mockFindDocumentEntityLinks = jest.fn()
const mockModuleEnabled = jest.fn()
const mockFeatureAllowed = jest.fn()
const mockVerifyTarget = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

jest.mock('../api/_shared', () => {
  const actual = jest.requireActual('../api/_shared')
  return {
    ...actual,
    resolveDocumentsContext: (...args: unknown[]) => mockResolveDocumentsContext(...args),
    handleDocumentsRouteError: (error: unknown) => {
      const candidate = error as { status?: unknown; body?: unknown }
      return Response.json(
        candidate.body && typeof candidate.body === 'object' ? candidate.body : { error: 'internal' },
        { status: typeof candidate.status === 'number' ? candidate.status : 500 },
      )
    },
    hasDocumentsFeature: (...args: unknown[]) => mockFeatureAllowed(...args),
  }
})

jest.mock('../api/_commands', () => ({
  attachDocumentsOperationMetadata: (response: Response) => response,
  buildDocumentsCommandRuntimeContext: jest.fn(),
  resolveDocumentsCommandBus: jest.fn(),
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
  isDocumentEntityRegistryModuleEnabled: (...args: unknown[]) => mockModuleEnabled(...args),
}))

jest.mock('../lib/entityRegistry.server', () => ({
  verifyEntityRegistryTargetAccess: (...args: unknown[]) => mockVerifyTarget(...args),
}))

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444'
const LINK_ID = '55555555-5555-4555-8555-555555555555'
const PRODUCT_ID = '66666666-6666-4666-8666-666666666666'
const HIDDEN_VALUE_ID = '77777777-7777-4777-8777-777777777777'
const NOW = new Date('2026-07-12T12:00:00.000Z')

function link(): DocumentEntityLink {
  return Object.assign(new DocumentEntityLink(), {
    id: LINK_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    documentId: DOCUMENT_ID,
    productId: PRODUCT_ID,
    labelSnapshot: `Legacy ${PRODUCT_ID}`,
    hrefSnapshot: `/legacy/products/${PRODUCT_ID}`,
    source: 'related-panel',
    createdByUserId: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  })
}

describe('related-record value projection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveDocumentsContext.mockResolvedValue({
      em: {},
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      auth: { userId: USER_ID, features: ['catalog.products.view'] },
    })
    mockAssertTier.mockResolvedValue('owner')
    mockFindDocumentEntityLinks.mockResolvedValue([link()])
    mockModuleEnabled.mockReturnValue(true)
    mockFeatureAllowed.mockReturnValue(true)
  })

  it('returns only current declared fields and nulls identifier-shaped values', async () => {
    mockVerifyTarget.mockResolvedValue({
      id: PRODUCT_ID,
      label: 'Current product',
      href: `/backend/catalog/products/${PRODUCT_ID}`,
      values: {
        title: 'Current product',
        subtitle: `Internal ${HIDDEN_VALUE_ID}${'x'.repeat(10_001)}`,
        sku: 'SKU-42',
        privateCost: '9000',
      },
    })
    const { GET } = await import('../api/[id]/links/route')
    const request = new Request(`http://localhost/api/documents/${DOCUMENT_ID}/links`)

    const response = await GET(request, { params: { id: DOCUMENT_ID } })
    const body = await response.json() as { items: Array<Record<string, unknown>> }

    expect(response.status).toBe(200)
    expect(mockVerifyTarget).toHaveBeenCalledWith(request, {
      entityType: 'product',
      entityId: PRODUCT_ID,
    })
    expect(body.items[0]).toMatchObject({
      entityId: PRODUCT_ID,
      label: 'Current product',
      canOpen: true,
      values: {
        title: 'Current product',
        subtitle: null,
        sku: 'SKU-42',
      },
    })
    expect((body.items[0]?.values as Record<string, unknown>).privateCost).toBeUndefined()
    expect(JSON.stringify(body.items[0]?.values)).not.toContain(HIDDEN_VALUE_ID)
  })

  it.each([
    ['feature denied', false, true, null],
    ['module disabled', true, false, null],
    ['target deleted', true, true, 404],
    ['target restricted or cross-scope', true, true, 403],
  ] as const)('redacts ID, href, and values when %s', async (_label, feature, module, rejection) => {
    mockFeatureAllowed.mockReturnValue(feature)
    mockModuleEnabled.mockReturnValue(module)
    if (rejection) mockVerifyTarget.mockRejectedValue({ status: rejection })
    const { GET } = await import('../api/[id]/links/route')

    const response = await GET(
      new Request(`http://localhost/api/documents/${DOCUMENT_ID}/links`),
      { params: { id: DOCUMENT_ID } },
    )
    const body = await response.json() as { items: Array<Record<string, unknown>> }
    const item = body.items[0]!

    expect(response.status).toBe(200)
    expect(item).toMatchObject({
      id: LINK_ID,
      entityId: null,
      label: 'Restricted record',
      href: null,
      canOpen: false,
    })
    expect(item.values).toBeUndefined()
    expect(JSON.stringify(item)).not.toContain(PRODUCT_ID)
  })
})
