import { DocumentTemplate } from '../data/entities'

const mockVerifyEntityRegistrySelections = jest.fn()
const mockIsDocumentEntityRegistryModuleEnabled = jest.fn()

jest.mock('../lib/entityRegistry.server', () => ({
  verifyEntityRegistrySelections: (...args: unknown[]) => mockVerifyEntityRegistrySelections(...args),
}))

jest.mock('../lib/entityRegistryAvailability.server', () => ({
  isDocumentEntityRegistryModuleEnabled: (...args: unknown[]) => (
    mockIsDocumentEntityRegistryModuleEnabled(...args)
  ),
}))

jest.mock('../lib/collabMaterializer', () => ({
  materializeDocumentHtml: (html: string) => ({
    yjsState: Buffer.from(html),
    html,
    text: html.replace(/<[^>]+>/g, ''),
  }),
}))

import { prepareTemplateRender } from '../lib/templateInstantiation'

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333'
const UPDATED_AT = new Date('2026-07-11T10:00:00.000Z')

function template(required = true): DocumentTemplate {
  return Object.assign(new DocumentTemplate(), {
    id: TEMPLATE_ID,
    name: 'Product brief',
    bodyHtml: '<p>Product brief {{product.title}}</p>',
    contextSlots: [{ slot: 'product', entityType: 'product', required }],
    createdByUserId: USER_ID,
    isActive: true,
    updatedAt: UPDATED_AT,
    deletedAt: null,
  })
}

function productSlot() {
  return {
    slot: 'product',
    entityType: 'product' as const,
    entityId: PRODUCT_ID,
    label: 'Atlas Runner',
    href: `/backend/catalog/products/${PRODUCT_ID}`,
    values: { title: 'Atlas Runner' },
  }
}

describe('template peer-module availability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsDocumentEntityRegistryModuleEnabled.mockReturnValue(false)
  })

  it('rejects a submitted slot before peer lookup when its module is disabled despite wildcard grants', async () => {
    await expect(prepareTemplateRender({
      request: new Request('http://localhost/api/documents/templates/preview'),
      template: template(),
      title: 'Quarterly brief',
      locale: 'en',
      effectiveDate: UPDATED_AT.toISOString(),
      templateUpdatedAt: UPDATED_AT.toISOString(),
      slots: [productSlot()],
      userFeatures: ['*'],
    })).rejects.toMatchObject({ status: 403 })

    expect(mockVerifyEntityRegistrySelections).not.toHaveBeenCalled()
  })

  it('rejects an unavailable required legacy slot even when the caller omits it', async () => {
    await expect(prepareTemplateRender({
      request: new Request('http://localhost/api/documents/templates/preview'),
      template: template(),
      title: 'Quarterly brief',
      locale: 'en',
      effectiveDate: UPDATED_AT.toISOString(),
      templateUpdatedAt: UPDATED_AT.toISOString(),
      slots: [],
      userFeatures: ['*'],
    })).rejects.toMatchObject({ status: 403 })

    expect(mockVerifyEntityRegistrySelections).not.toHaveBeenCalled()
  })

  it('allows an omitted optional legacy slot without contacting its disabled peer module', async () => {
    mockVerifyEntityRegistrySelections.mockResolvedValue(new Map())

    await expect(prepareTemplateRender({
      request: new Request('http://localhost/api/documents/templates/preview'),
      template: template(false),
      title: 'Quarterly brief',
      locale: 'en',
      effectiveDate: UPDATED_AT.toISOString(),
      templateUpdatedAt: UPDATED_AT.toISOString(),
      slots: [],
      userFeatures: ['documents.create'],
    })).resolves.toMatchObject({
      verifiedSlots: [],
      render: { unresolvedTokens: [] },
    })

    expect(mockVerifyEntityRegistrySelections).toHaveBeenCalledWith(
      expect.any(Request),
      [],
    )
  })
})
