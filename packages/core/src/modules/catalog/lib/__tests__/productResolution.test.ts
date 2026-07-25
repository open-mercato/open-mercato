import { resolveProductBySkuOrExternalId } from '../productResolution'

function createMockEm() {
  const em = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  return em
}

const ORG_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const PRODUCT_ID = '44444444-4444-4444-8444-444444444444'
const SCOPE = { organizationId: ORG_ID, tenantId: TENANT_ID }

describe('resolveProductBySkuOrExternalId', () => {
  it('returns null without querying when no identifiers are provided', async () => {
    const em = createMockEm()
    const result = await resolveProductBySkuOrExternalId(em as never, {}, SCOPE)
    expect(result).toBeNull()
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('resolves by sku scoped to org/tenant and excludes soft-deleted rows', async () => {
    const em = createMockEm()
    const product = { id: PRODUCT_ID, sku: 'ABC-1', organizationId: ORG_ID, tenantId: TENANT_ID }
    em.findOne.mockResolvedValueOnce(product)

    const result = await resolveProductBySkuOrExternalId(em as never, { sku: 'ABC-1' }, SCOPE)

    expect(result).toBe(product)
    expect(em.findOne).toHaveBeenCalledTimes(1)
    const filter = em.findOne.mock.calls[0][1] as Record<string, unknown>
    expect(filter.sku).toBe('ABC-1')
    expect(filter.organizationId).toBe(ORG_ID)
    expect(filter.tenantId).toBe(TENANT_ID)
    expect(filter.deletedAt).toBeNull()
  })

  it('returns null when the sku lookup finds nothing', async () => {
    const em = createMockEm()
    const result = await resolveProductBySkuOrExternalId(em as never, { sku: 'missing' }, SCOPE)
    expect(result).toBeNull()
    expect(em.findOne).toHaveBeenCalledTimes(1)
  })

  it('resolves by externalId (OM product id) when it is a valid UUID without a sku query', async () => {
    const em = createMockEm()
    const product = { id: PRODUCT_ID, organizationId: ORG_ID, tenantId: TENANT_ID }
    em.findOne.mockResolvedValueOnce(product)

    const result = await resolveProductBySkuOrExternalId(
      em as never,
      { externalId: PRODUCT_ID, sku: 'ABC-1' },
      SCOPE,
    )

    expect(result).toBe(product)
    expect(em.findOne).toHaveBeenCalledTimes(1)
    const filter = em.findOne.mock.calls[0][1] as Record<string, unknown>
    expect(filter.id).toBe(PRODUCT_ID)
    expect(filter.organizationId).toBe(ORG_ID)
    expect(filter.tenantId).toBe(TENANT_ID)
    expect(filter.deletedAt).toBeNull()
    expect(filter.sku).toBeUndefined()
  })

  it('falls back to the sku lookup when the externalId match is not found', async () => {
    const em = createMockEm()
    const product = { id: PRODUCT_ID, sku: 'ABC-1', organizationId: ORG_ID, tenantId: TENANT_ID }
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(product)

    const result = await resolveProductBySkuOrExternalId(
      em as never,
      { externalId: PRODUCT_ID, sku: 'ABC-1' },
      SCOPE,
    )

    expect(result).toBe(product)
    expect(em.findOne).toHaveBeenCalledTimes(2)
    expect((em.findOne.mock.calls[0][1] as Record<string, unknown>).id).toBe(PRODUCT_ID)
    expect((em.findOne.mock.calls[1][1] as Record<string, unknown>).sku).toBe('ABC-1')
  })

  it('skips the id query for a non-UUID externalId and uses the sku fallback', async () => {
    const em = createMockEm()
    const product = { id: PRODUCT_ID, sku: 'MAGENTO-SKU', organizationId: ORG_ID, tenantId: TENANT_ID }
    em.findOne.mockResolvedValueOnce(product)

    const result = await resolveProductBySkuOrExternalId(
      em as never,
      { externalId: 'not-a-uuid', sku: 'MAGENTO-SKU' },
      SCOPE,
    )

    expect(result).toBe(product)
    expect(em.findOne).toHaveBeenCalledTimes(1)
    const filter = em.findOne.mock.calls[0][1] as Record<string, unknown>
    expect(filter.sku).toBe('MAGENTO-SKU')
    expect(filter.id).toBeUndefined()
  })

  it('returns null without querying when only a non-UUID externalId is provided', async () => {
    const em = createMockEm()
    const result = await resolveProductBySkuOrExternalId(em as never, { externalId: 'not-a-uuid' }, SCOPE)
    expect(result).toBeNull()
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('trims surrounding whitespace from identifiers before querying', async () => {
    const em = createMockEm()
    em.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    await resolveProductBySkuOrExternalId(
      em as never,
      { externalId: `  ${PRODUCT_ID}  `, sku: '  ABC-1  ' },
      SCOPE,
    )

    expect((em.findOne.mock.calls[0][1] as Record<string, unknown>).id).toBe(PRODUCT_ID)
    expect((em.findOne.mock.calls[1][1] as Record<string, unknown>).sku).toBe('ABC-1')
  })

  it('ignores empty-string identifiers', async () => {
    const em = createMockEm()
    const result = await resolveProductBySkuOrExternalId(
      em as never,
      { externalId: '   ', sku: '' },
      SCOPE,
    )
    expect(result).toBeNull()
    expect(em.findOne).not.toHaveBeenCalled()
  })
})
