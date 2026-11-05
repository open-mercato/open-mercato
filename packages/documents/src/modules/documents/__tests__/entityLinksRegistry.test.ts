import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentEntityLink } from '../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { E } from '../../../../generated/entities.ids.generated'
import {
  assertDocumentEntityLinkCapacity,
  assertDocumentEntityLinkListWithinLimit,
  buildDocumentEntityLinkTarget,
  findDocumentEntityLinks,
  getDocumentEntityLinkEntityId,
  getDocumentEntityLinkType,
  serializeDocumentEntityLink,
} from '../lib/entityLinks'
import { getEntityRegistryEntry } from '../lib/entityRegistry'
import { DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT } from '../lib/resourceLimits'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

const ID = '11111111-1111-4111-8111-111111111111'
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222'
const DOCUMENT_ID = '33333333-3333-4333-8333-333333333333'
const TENANT_A = '44444444-4444-4444-8444-444444444444'
const TENANT_B = '55555555-5555-4555-8555-555555555555'
const ORG_A = '66666666-6666-4666-8666-666666666666'
const ORG_B = '77777777-7777-4777-8777-777777777777'

const findWithDecryptionMock = jest.mocked(findWithDecryption)

describe('document entity-link registry', () => {
  beforeEach(() => {
    findWithDecryptionMock.mockReset()
  })

  it.each([
    ['customer-person', 'customerEntityId', 'person'],
    ['customer-company', 'customerEntityId', 'company'],
    ['deal', 'dealId', null],
    ['product', 'productId', null],
    ['catalog-offer', 'catalogOfferId', null],
    ['quote', 'quoteId', null],
    ['sales-order', 'salesOrderId', null],
  ] as const)('round-trips %s through its typed target column', (entityType, targetField, customerKind) => {
    const target = buildDocumentEntityLinkTarget(entityType, ID)
    expect(target[targetField]).toBe(ID)
    expect(target.customerKind).toBe(customerKind)
    const link = Object.assign(new DocumentEntityLink(), target)
    expect(getDocumentEntityLinkType(link)).toBe(entityType)
    expect(getDocumentEntityLinkEntityId(link)).toBe(ID)
  })

  it('maps offers to their parent product and rejects malformed lookalike hrefs', () => {
    const entry = getEntityRegistryEntry('catalog-offer')!
    const mapped = entry.mapItem({
      id: ID,
      title: 'Annual offer',
      productId: PRODUCT_ID,
    })!
    expect(mapped.href).toBe(`/backend/catalog/products/${PRODUCT_ID}`)
    expect(entry.resolveHref(mapped)).toBe(mapped.href)
    expect(entry.isCanonicalHref(mapped, mapped.href!)).toBe(true)
    expect(entry.resolveHref({ ...mapped, href: '/backend/catalog/products/------------------------------------' })).toBeNull()
  })

  it('never maps UUID-shaped peer fields into picker labels, subtitles, or template tokens', () => {
    const leakedLabel = `Internal ${ID}`
    const person = getEntityRegistryEntry('customer-person')!
    expect(person.mapItem({ id: ID, name: leakedLabel, email: 'ada@example.test' })).toMatchObject({
      id: ID,
      label: 'ada@example.test',
      subtitle: 'ada@example.test',
    })

    const deal = getEntityRegistryEntry('deal')!
    expect(deal.mapItem({ id: ID, title: leakedLabel })).toBeNull()

    const product = getEntityRegistryEntry('product')!
    expect(product.mapItem({ id: ID, title: 'Readable desk', sku: leakedLabel })).toEqual({
      id: ID,
      label: 'Readable desk',
      subtitle: undefined,
    })
    expect(product.tokenFields.find((token) => token.field === 'sku')?.extract({ sku: leakedLabel })).toBeNull()

    const offer = getEntityRegistryEntry('catalog-offer')!
    expect(offer.mapItem({
      id: ID,
      title: leakedLabel,
      productId: PRODUCT_ID,
      product: { title: 'Readable parent', sku: leakedLabel },
    })).toMatchObject({ label: 'Readable parent' })

    expect(getEntityRegistryEntry('quote')!.mapItem({ id: ID, quoteNumber: leakedLabel })).toBeNull()
    expect(getEntityRegistryEntry('sales-order')!.mapItem({ id: ID, orderNumber: leakedLabel })).toBeNull()
  })

  it('serializes an unsafe legacy label snapshot with the localized neutral fallback', () => {
    const link = Object.assign(new DocumentEntityLink(), {
      id: ID,
      productId: PRODUCT_ID,
      labelSnapshot: `Customer ${ID}`,
      hrefSnapshot: `/backend/catalog/products/${PRODUCT_ID}`,
      source: 'chip' as const,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
    })

    const serialized = serializeDocumentEntityLink(link, {
      canOpen: true,
      restrictedLabel: 'Restricted record',
    })
    expect(serialized.label).toBe('Restricted record')
    expect(JSON.stringify(serialized)).not.toContain(`Customer ${ID}`)
  })

  it('keeps the handwritten entity ID aligned with the generator contract', () => {
    expect(DOCUMENTS_ENTITY_IDS.documentEntityLink).toBe(E.documents.document_entity_link)
  })

  it('cannot load an entity link through a different tenant or organization scope', async () => {
    const stored = Object.assign(new DocumentEntityLink(), {
      id: ID,
      documentId: DOCUMENT_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
      productId: PRODUCT_ID,
      labelSnapshot: 'Encrypted after persistence',
      hrefSnapshot: `/backend/catalog/products/${PRODUCT_ID}`,
      source: 'related-panel' as const,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      deletedAt: null,
    })
    findWithDecryptionMock.mockImplementation(async (_em, _entity, where) => {
      const filter = where as {
        documentId: string
        tenantId: string
        organizationId: string
        deletedAt?: null
      }
      return [stored].filter((row) => (
        row.documentId === filter.documentId
        && row.tenantId === filter.tenantId
        && row.organizationId === filter.organizationId
        && (filter.deletedAt === undefined || row.deletedAt === filter.deletedAt)
      ))
    })

    await expect(findDocumentEntityLinks(
      {} as never,
      DOCUMENT_ID,
      { tenantId: TENANT_B, organizationId: ORG_A },
    )).resolves.toEqual([])
    await expect(findDocumentEntityLinks(
      {} as never,
      DOCUMENT_ID,
      { tenantId: TENANT_A, organizationId: ORG_B },
    )).resolves.toEqual([])

    expect(findWithDecryptionMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      DocumentEntityLink,
      {
        documentId: DOCUMENT_ID,
        tenantId: TENANT_B,
        organizationId: ORG_A,
        deletedAt: null,
      },
      {
        orderBy: { createdAt: 'ASC' },
        limit: DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT + 1,
      },
      { tenantId: TENANT_B, organizationId: ORG_A },
    )
    expect(findWithDecryptionMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      DocumentEntityLink,
      {
        documentId: DOCUMENT_ID,
        tenantId: TENANT_A,
        organizationId: ORG_B,
        deletedAt: null,
      },
      {
        orderBy: { createdAt: 'ASC' },
        limit: DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT + 1,
      },
      { tenantId: TENANT_A, organizationId: ORG_B },
    )
  })

  it('fails before peer work when persisted or active links exceed the aggregate cap', async () => {
    const overLimit = Array.from(
      { length: DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT + 1 },
      () => Object.assign(new DocumentEntityLink(), { id: ID }),
    )
    expect(() => assertDocumentEntityLinkListWithinLimit(overLimit)).toThrow(
      expect.objectContaining({ status: 413 }),
    )

    const count = jest.fn(async () => DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT)
    await expect(assertDocumentEntityLinkCapacity(
      { count } as never,
      DOCUMENT_ID,
      { tenantId: TENANT_A, organizationId: ORG_A },
    )).rejects.toMatchObject({
      status: 413,
      body: { error: 'documents.links.limitExceeded' },
    })
    expect(count).toHaveBeenCalledWith(DocumentEntityLink, {
      documentId: DOCUMENT_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
      deletedAt: null,
    })
  })

  it('returns exactly the active cap while leaving deleted-history reads backward compatible', async () => {
    const active = Array.from(
      { length: DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT },
      (_, index) => Object.assign(new DocumentEntityLink(), { id: `${index}` }),
    )
    const historical = Array.from(
      { length: DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT + 25 },
      (_, index) => Object.assign(new DocumentEntityLink(), {
        id: `deleted-${index}`,
        deletedAt: new Date('2026-07-10T00:00:00.000Z'),
      }),
    )
    findWithDecryptionMock
      .mockResolvedValueOnce(active)
      .mockResolvedValueOnce(historical)

    await expect(findDocumentEntityLinks(
      {} as never,
      DOCUMENT_ID,
      { tenantId: TENANT_A, organizationId: ORG_A },
    )).resolves.toHaveLength(DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT)
    await expect(findDocumentEntityLinks(
      {} as never,
      DOCUMENT_ID,
      { tenantId: TENANT_A, organizationId: ORG_A },
      { withDeleted: true },
    )).resolves.toHaveLength(DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT + 25)

    expect(findWithDecryptionMock.mock.calls[0]?.[3]).toEqual({
      orderBy: { createdAt: 'ASC' },
      limit: DOCUMENTS_MAX_ENTITY_LINKS_PER_DOCUMENT + 1,
    })
    expect(findWithDecryptionMock.mock.calls[1]?.[2]).toEqual({
      documentId: DOCUMENT_ID,
      tenantId: TENANT_A,
      organizationId: ORG_A,
    })
    expect(findWithDecryptionMock.mock.calls[1]?.[3]).toEqual({
      orderBy: { createdAt: 'ASC' },
    })
  })
})
