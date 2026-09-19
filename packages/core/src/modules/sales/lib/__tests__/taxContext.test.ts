import { CatalogProduct, CatalogProductVariant } from '../../../catalog/data/entities'
import {
  DEFAULT_TAX_PROVIDER_KEY,
  DEFAULT_TAX_PROVIDER_TIMEOUT_MS,
  clampTaxProviderTimeout,
  resolveTaxDocumentContext,
  resolveTaxDocumentIntent,
  toTaxAddress,
  toTaxCustomer,
} from '../providers/taxContext'
import { registerTaxProvider } from '../providers/registry'
import { tableRatesTaxProvider } from '../providers/taxProviders'
import type { TaxProvider } from '../providers/types'

type FindCall = { entity: unknown; where: Record<string, unknown> }

function makeEm(rows: { products?: unknown[]; variants?: unknown[]; settings?: unknown } = {}) {
  const calls: FindCall[] = []
  const em = {
    calls,
    // The tax provider selection is read from sales_settings on the same
    // EntityManager. It is deliberately NOT recorded in `calls`, which counts
    // only the catalog reads these cases are about.
    async findOne() {
      return rows.settings ?? null
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      calls.push({ entity, where })
      if (entity === CatalogProduct) return rows.products ?? []
      if (entity === CatalogProductVariant) return rows.variants ?? []
      return []
    },
  }
  return em as typeof em & Parameters<typeof resolveTaxDocumentContext>[0]['em']
}

const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

let unregister: Array<() => void> = []

afterEach(() => {
  unregister.forEach((fn) => fn())
  unregister = []
})

function withProvider(provider: TaxProvider) {
  unregister.push(registerTaxProvider(provider))
}

describe('resolveTaxDocumentIntent', () => {
  it('treats quotes and orders as estimates and invoices and credit memos as records', () => {
    expect(resolveTaxDocumentIntent('quote')).toBe('estimate')
    expect(resolveTaxDocumentIntent('order')).toBe('estimate')
    expect(resolveTaxDocumentIntent('invoice')).toBe('record')
    expect(resolveTaxDocumentIntent('credit_memo')).toBe('record')
  })
})

describe('clampTaxProviderTimeout', () => {
  it('keeps a value inside the documented bounds', () => {
    expect(clampTaxProviderTimeout(5000)).toBe(5000)
    expect(clampTaxProviderTimeout(10)).toBe(1000)
    expect(clampTaxProviderTimeout(999999)).toBe(30000)
    expect(clampTaxProviderTimeout('2500')).toBe(2500)
    expect(clampTaxProviderTimeout(undefined)).toBe(DEFAULT_TAX_PROVIDER_TIMEOUT_MS)
    expect(clampTaxProviderTimeout('not a number')).toBe(DEFAULT_TAX_PROVIDER_TIMEOUT_MS)
  })
})

describe('toTaxAddress', () => {
  it('maps the keys resolveAddressSnapshot writes', () => {
    expect(
      toTaxAddress({
        addressLine1: 'One Market St',
        addressLine2: 'Suite 300',
        buildingNumber: '1',
        flatNumber: '300',
        city: 'San Francisco',
        region: 'CA',
        postalCode: '94105',
        country: 'US',
        latitude: 37.7935,
        longitude: '-122.3959',
        isPrimary: true,
      })
    ).toEqual({
      line1: 'One Market St',
      line2: 'Suite 300',
      buildingNumber: '1',
      flatNumber: '300',
      city: 'San Francisco',
      region: 'CA',
      postalCode: '94105',
      country: 'US',
      latitude: 37.7935,
      longitude: -122.3959,
    })
  })

  it('returns null for an absent snapshot and nulls empty strings', () => {
    expect(toTaxAddress(null)).toBeNull()
    expect(toTaxAddress('not an object')).toBeNull()
    expect(toTaxAddress({ addressLine1: '   ' })?.line1).toBeNull()
  })
})

describe('toTaxCustomer', () => {
  it('builds the customer block and takes the tax id from the billing address', () => {
    const customer = toTaxCustomer(
      { customer: { id: 'cust-1', kind: 'company', displayName: 'Acme Inc' } },
      { taxId: 'US123456789', taxIdType: 'ein' }
    )
    expect(customer).toEqual({
      id: 'cust-1',
      kind: 'company',
      code: 'cust-1',
      displayName: 'Acme Inc',
      taxId: 'US123456789',
      taxIdType: 'ein',
      exemption: null,
    })
  })

  it('carries the exemption block when the snapshot has one', () => {
    const customer = toTaxCustomer(
      {
        customer: {
          id: 'cust-2',
          kind: 'person',
          displayName: null,
          taxExemption: { isExempt: true, code: 'RESALE', certificateNumber: 'CERT-9' },
        },
      },
      null
    )
    expect(customer?.exemption).toEqual({
      isExempt: true,
      code: 'RESALE',
      certificateNumber: 'CERT-9',
    })
  })

  it('returns null without a customer id and nulls an unknown kind', () => {
    expect(toTaxCustomer(null, null)).toBeNull()
    expect(toTaxCustomer({ customer: {} }, null)).toBeNull()
    expect(toTaxCustomer({ customer: { id: 'cust-3', kind: 'alien' } }, null)?.kind).toBeNull()
  })
})

describe('resolveTaxDocumentContext', () => {
  const baseParams = {
    ...scope,
    documentKind: 'order' as const,
    documentId: 'order-1',
    documentNumber: 'SO-1',
    documentDate: new Date('2026-09-19T08:00:00.000Z'),
    channelId: 'channel-1',
  }

  it('issues one batched product query for many lines', async () => {
    const em = makeEm({
      products: [
        {
          id: 'prod-1',
          sku: 'SKU-1',
          taxRateId: 'rate-1',
          taxClassificationCode: 'P0000000',
          hsCode: '1234.56',
        },
        { id: 'prod-2', sku: 'SKU-2', taxRateId: null, taxClassificationCode: null, hsCode: null },
      ],
    })
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      loadProductFacts: true,
      lines: [
        { productId: 'prod-1' },
        { productId: 'prod-2' },
        { productId: 'prod-1' },
        { productId: 'prod-2' },
      ],
    })
    expect(em.calls).toHaveLength(1)
    expect(em.calls[0].entity).toBe(CatalogProduct)
    expect(em.calls[0].where).toMatchObject({
      id: { $in: ['prod-1', 'prod-2'] },
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
    expect(context.productFacts['prod-1']).toEqual({
      sku: 'SKU-1',
      taxRateId: 'rate-1',
      taxClassificationCode: 'P0000000',
      taxCode: null,
      isTaxable: true,
      hsCode: '1234.56',
    })
  })

  it('prefers the line catalog snapshot over a catalog read', async () => {
    const em = makeEm()
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      loadProductFacts: true,
      lines: [
        {
          productId: 'prod-1',
          catalogSnapshot: {
            sku: 'SNAPSHOT-SKU',
            taxRateId: 'snapshot-rate',
            taxClassificationCode: 'SNAP',
            hsCode: '9999.99',
          },
        },
      ],
    })
    expect(em.calls).toHaveLength(0)
    expect(context.productFacts['prod-1']).toEqual({
      sku: 'SNAPSHOT-SKU',
      taxRateId: 'snapshot-rate',
      taxClassificationCode: 'SNAP',
      taxCode: null,
      isTaxable: true,
      hsCode: '9999.99',
    })
  })

  it('falls back to the parent product for facts a variant does not carry', async () => {
    const em = makeEm({
      products: [
        {
          id: 'prod-1',
          sku: 'SKU-1',
          taxRateId: 'rate-1',
          taxClassificationCode: 'P0000000',
          hsCode: '1111.11',
        },
      ],
      variants: [
        {
          id: 'var-1',
          product: { id: 'prod-1' },
          sku: 'VAR-SKU',
          taxRateId: null,
          hsCode: null,
        },
      ],
    })
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      loadProductFacts: true,
      lines: [{ productId: 'prod-1', productVariantId: 'var-1' }],
    })
    expect(context.productFacts['var-1']).toEqual({
      sku: 'VAR-SKU',
      taxRateId: 'rate-1',
      taxClassificationCode: 'P0000000',
      taxCode: null,
      isTaxable: true,
      hsCode: '1111.11',
    })
  })

  it('prefers the variant tax code and taxable flag over the parent product', async () => {
    const em = makeEm({
      products: [{ id: 'prod-1', taxCode: 'PC040100', isTaxable: true }],
      variants: [{ id: 'var-1', product: { id: 'prod-1' }, taxCode: 'PC030000', isTaxable: false }],
    })
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      loadProductFacts: true,
      lines: [{ productId: 'prod-1', productVariantId: 'var-1' }],
    })
    expect(context.productFacts['var-1']).toMatchObject({ taxCode: 'PC030000', isTaxable: false })
    expect(context.productFacts['prod-1']).toMatchObject({ taxCode: 'PC040100', isTaxable: true })
  })

  it('falls back to the parent product for a tax code and a taxable flag the variant omits', async () => {
    const em = makeEm({
      products: [{ id: 'prod-1', taxCode: 'PC040100', isTaxable: false }],
      variants: [{ id: 'var-1', product: { id: 'prod-1' }, taxCode: null, isTaxable: undefined }],
    })
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      loadProductFacts: true,
      lines: [{ productId: 'prod-1', productVariantId: 'var-1' }],
    })
    expect(context.productFacts['var-1']).toMatchObject({ taxCode: 'PC040100', isTaxable: false })
  })

  it('defaults to no tax code and a taxable product when neither row says anything', async () => {
    const em = makeEm({
      products: [{ id: 'prod-1', sku: 'SKU-1', taxCode: null, isTaxable: undefined }],
      variants: [{ id: 'var-1', product: { id: 'prod-1' }, sku: 'VAR-SKU' }],
    })
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      loadProductFacts: true,
      lines: [{ productId: 'prod-1', productVariantId: 'var-1' }],
    })
    expect(context.productFacts['prod-1']).toMatchObject({ taxCode: null, isTaxable: true })
    expect(context.productFacts['var-1']).toMatchObject({ taxCode: null, isTaxable: true })
  })

  it('takes the tax code and the taxable flag from the line catalog snapshot', async () => {
    const em = makeEm()
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      loadProductFacts: true,
      lines: [
        { productId: 'prod-1', catalogSnapshot: { tax_code: 'PC050000', is_taxable: false } },
      ],
    })
    expect(em.calls).toHaveLength(0)
    expect(context.productFacts['prod-1']).toMatchObject({
      taxCode: 'PC050000',
      isTaxable: false,
    })
  })

  it('reads the catalog facts when the selected provider declares it needs them', async () => {
    withProvider({
      key: 'facts-hungry',
      label: 'Facts hungry',
      needsProductFacts: true,
      calculate: () => null,
    })
    const em = makeEm({
      products: [{ id: 'prod-1', sku: 'SKU-1', taxCode: 'PC040100' }],
      settings: { taxProviderKey: 'facts-hungry' },
    })
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      lines: [{ productId: 'prod-1' }],
    })
    expect(em.calls).toHaveLength(1)
    expect(context.productFacts['prod-1']).toMatchObject({ taxCode: 'PC040100' })
  })

  it('skips the catalog read when the selected provider declares it does not need the facts', async () => {
    withProvider({
      key: 'facts-free',
      label: 'Facts free',
      needsProductFacts: false,
      calculate: () => null,
    })
    const em = makeEm({
      products: [{ id: 'prod-1', sku: 'SKU-1' }],
      settings: { taxProviderKey: 'facts-free' },
    })
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      lines: [{ productId: 'prod-1' }],
    })
    expect(em.calls).toHaveLength(0)
    expect(context.productFacts).toEqual({})
  })

  it('keeps the built in default provider on the cheap path through its own declaration', async () => {
    withProvider(tableRatesTaxProvider)
    const em = makeEm({
      products: [{ id: 'prod-1', sku: 'SKU-1' }],
      settings: { taxProviderKey: DEFAULT_TAX_PROVIDER_KEY },
    })
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      lines: [{ productId: 'prod-1' }],
    })
    expect(em.calls).toHaveLength(0)
    expect(context.productFacts).toEqual({})
  })

  it('reads the catalog facts for a provider that declares nothing either way', async () => {
    withProvider({ key: 'undeclared', label: 'Undeclared', calculate: () => null })
    const em = makeEm({
      products: [{ id: 'prod-1', sku: 'SKU-1' }],
      settings: { taxProviderKey: 'undeclared' },
    })
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      lines: [{ productId: 'prod-1' }],
    })
    expect(em.calls).toHaveLength(1)
    expect(context.productFacts['prod-1']).toMatchObject({ sku: 'SKU-1' })
  })

  it('reads no catalog fact for the built in default provider, which never uses them', async () => {
    const em = makeEm({ products: [{ id: 'prod-1', sku: 'SKU-1' }] })
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      lines: [{ productId: 'prod-1' }],
    })
    expect(em.calls).toHaveLength(0)
    expect(context.productFacts).toEqual({})
  })

  it('makes no catalog query for a document without lines', async () => {
    const em = makeEm()
    const context = await resolveTaxDocumentContext({ em, ...baseParams, loadProductFacts: true })
    expect(em.calls).toHaveLength(0)
    expect(context.productFacts).toEqual({})
  })

  it('defaults to the built in provider with no credentials', async () => {
    const em = makeEm()
    const context = await resolveTaxDocumentContext({ em, ...baseParams })
    expect(context.selection).toEqual({
      providerKey: DEFAULT_TAX_PROVIDER_KEY,
      settings: {},
      integrationId: null,
      integrationEnabled: true,
    })
    expect(await context.resolveCredentials()).toEqual({})
    expect(context.addresses.shipFrom).toBeNull()
    expect(context.totalsMode).toBe('computed')
    expect(context.document).toEqual({
      kind: 'order',
      id: 'order-1',
      number: 'SO-1',
      date: '2026-09-19T08:00:00.000Z',
      channelId: 'channel-1',
      intent: 'estimate',
    })
  })

  it('keeps the credentials closure out of a serialized context', async () => {
    const em = makeEm()
    const context = await resolveTaxDocumentContext({ em, ...baseParams })
    const serialized = JSON.stringify({ metadata: { tax: context } })
    expect(serialized).not.toContain('resolveCredentials')
  })

  it('maps both address snapshots', async () => {
    const em = makeEm()
    const context = await resolveTaxDocumentContext({
      em,
      ...baseParams,
      shippingAddressSnapshot: { addressLine1: 'Ship St', city: 'Austin', country: 'US' },
      billingAddressSnapshot: { addressLine1: 'Bill St', city: 'Dallas', country: 'US' },
    })
    expect(context.addresses.shipTo?.city).toBe('Austin')
    expect(context.addresses.billTo?.city).toBe('Dallas')
  })

  it('falls back to now when the document carries no date', async () => {
    const em = makeEm()
    const before = Date.now()
    const context = await resolveTaxDocumentContext({ em, ...baseParams, documentDate: null })
    expect(new Date(context.document.date).getTime()).toBeGreaterThanOrEqual(before)
  })
})
