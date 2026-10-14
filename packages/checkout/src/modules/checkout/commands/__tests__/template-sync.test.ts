import type { CheckoutLink } from '../../data/entities'
import {
  buildSelectiveLinkedCustomFieldUpdates,
  buildSelectiveLinkedLinkSnapshot,
  restoreLinkFromSnapshot,
  type CheckoutLinkSnapshot,
  type CheckoutTemplateSnapshot,
} from '../shared'

function createTemplateSnapshot(overrides: Partial<CheckoutTemplateSnapshot> = {}): CheckoutTemplateSnapshot {
  return {
    id: 'template_1',
    organizationId: 'org_test',
    tenantId: 'tenant_test',
    name: 'Template name',
    title: 'Template title',
    subtitle: 'Template subtitle',
    description: 'Template description',
    logoAttachmentId: null,
    logoUrl: null,
    logoPreviewUrl: null,
    primaryColor: '#111111',
    secondaryColor: '#222222',
    backgroundColor: '#333333',
    themeMode: 'auto',
    pricingMode: 'fixed',
    fixedPriceAmount: 49.99,
    fixedPriceAmountExact: '49.99',
    fixedPriceCurrencyCode: 'USD',
    fixedPriceIncludesTax: true,
    fixedPriceOriginalAmount: 69.99,
    fixedPriceOriginalAmountExact: '69.99',
    customAmountMin: null,
    customAmountMinExact: null,
    customAmountMax: null,
    customAmountMaxExact: null,
    customAmountCurrencyCode: null,
    priceListItems: [],
    gatewayProviderKey: 'mock',
    gatewaySettings: {},
    customFieldsetCode: null,
    collectCustomerDetails: true,
    customerFieldsSchema: [],
    legalDocuments: {},
    displayCustomFieldsOnPage: false,
    successTitle: null,
    successMessage: null,
    cancelTitle: null,
    cancelMessage: null,
    errorTitle: null,
    errorMessage: null,
    successEmailSubject: null,
    successEmailBody: null,
    sendSuccessEmail: true,
    errorEmailSubject: null,
    errorEmailBody: null,
    sendErrorEmail: true,
    startEmailSubject: null,
    startEmailBody: null,
    sendStartEmail: true,
    passwordHash: null,
    maxCompletions: null,
    status: 'draft',
    checkoutType: 'pay_link',
    createdAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
    custom: {},
    ...overrides,
  }
}

function createLinkSnapshot(overrides: Partial<CheckoutLinkSnapshot> = {}): CheckoutLinkSnapshot {
  return {
    ...createTemplateSnapshot(),
    slug: 'link-slug',
    templateId: 'template_1',
    completionCount: 0,
    activeReservationCount: 0,
    isLocked: false,
    ...overrides,
  }
}

describe('template link sync helpers', () => {
  it('updates only fields that still match the previous template snapshot', () => {
    const before = createTemplateSnapshot({
      title: 'Old title',
      subtitle: 'Old subtitle',
    })
    const after = createTemplateSnapshot({
      title: 'New title',
      subtitle: 'New subtitle',
    })
    const link = createLinkSnapshot({
      title: 'Manual override',
      subtitle: 'Old subtitle',
    })

    const result = buildSelectiveLinkedLinkSnapshot(link, before, after)

    expect(result.changed).toBe(true)
    expect(result.snapshot.title).toBe('Manual override')
    expect(result.snapshot.subtitle).toBe('New subtitle')
  })

  it('only updates custom fields that still match the previous template values', () => {
    const updates = buildSelectiveLinkedCustomFieldUpdates(
      {
        synced: 'old value',
        overridden: 'manual value',
        removed: 'legacy value',
      },
      {
        synced: 'old value',
        overridden: 'old override',
        removed: 'legacy value',
      },
      {
        synced: 'new value',
      },
    )

    expect(updates).toEqual({
      synced: 'new value',
      removed: null,
    })
  })

  it('propagates changed template amounts together with their exact values', () => {
    const before = createTemplateSnapshot({
      fixedPriceAmount: 10,
      fixedPriceAmountExact: '10',
      fixedPriceOriginalAmount: 15,
      fixedPriceOriginalAmountExact: '15',
    })
    const after = createTemplateSnapshot({
      fixedPriceAmount: 20,
      fixedPriceAmountExact: '20',
      fixedPriceOriginalAmount: 25,
      fixedPriceOriginalAmountExact: '25',
    })
    const link = createLinkSnapshot({
      fixedPriceAmount: 10,
      fixedPriceAmountExact: '10',
      fixedPriceOriginalAmount: 30,
      fixedPriceOriginalAmountExact: '30',
    })

    const result = buildSelectiveLinkedLinkSnapshot(link, before, after)

    expect(result.changed).toBe(true)
    expect(result.snapshot.fixedPriceAmount).toBe(20)
    expect(result.snapshot.fixedPriceAmountExact).toBe('20')
    expect(result.snapshot.fixedPriceOriginalAmount).toBe(30)
    expect(result.snapshot.fixedPriceOriginalAmountExact).toBe('30')

    const target = {} as CheckoutLink
    restoreLinkFromSnapshot(target, result.snapshot)
    expect(target.fixedPriceAmount).toBe('20')
    expect(target.fixedPriceOriginalAmount).toBe('30')
  })

  it('compares template amounts on their exact values beyond float precision', () => {
    const before = createTemplateSnapshot({
      pricingMode: 'custom_amount',
      customAmountMin: Number('1.123456789012345678'),
      customAmountMinExact: '1.123456789012345678',
      customAmountMax: Number('9.999999999999999998'),
      customAmountMaxExact: '9.999999999999999998',
    })
    const after = createTemplateSnapshot({
      pricingMode: 'custom_amount',
      customAmountMin: Number('1.123456789012345679'),
      customAmountMinExact: '1.123456789012345679',
      customAmountMax: Number('9.999999999999999999'),
      customAmountMaxExact: '9.999999999999999999',
    })
    const link = createLinkSnapshot({
      pricingMode: 'custom_amount',
      customAmountMin: Number('1.123456789012345678'),
      customAmountMinExact: '1.123456789012345678',
      customAmountMax: Number('9.999999999999999997'),
      customAmountMaxExact: '9.999999999999999997',
    })

    const result = buildSelectiveLinkedLinkSnapshot(link, before, after)

    expect(result.changed).toBe(true)
    expect(result.snapshot.customAmountMinExact).toBe('1.123456789012345679')
    expect(result.snapshot.customAmountMaxExact).toBe('9.999999999999999997')

    const target = {} as CheckoutLink
    restoreLinkFromSnapshot(target, result.snapshot)
    expect(target.customAmountMin).toBe('1.123456789012345679')
    expect(target.customAmountMax).toBe('9.999999999999999997')
  })

  it('reports no change when only float-equal amounts match on their exact values', () => {
    const template = createTemplateSnapshot({
      fixedPriceAmount: Number('1.123456789012345678'),
      fixedPriceAmountExact: '1.123456789012345678',
    })
    const link = createLinkSnapshot({
      fixedPriceAmount: Number('1.123456789012345678'),
      fixedPriceAmountExact: '1.123456789012345678',
    })

    const result = buildSelectiveLinkedLinkSnapshot(link, template, createTemplateSnapshot({
      fixedPriceAmount: Number('1.123456789012345678'),
      fixedPriceAmountExact: '1.1234567890123456780',
    }))

    expect(result.changed).toBe(false)
    expect(result.snapshot.fixedPriceAmountExact).toBe('1.123456789012345678')
  })

  it('still propagates amounts from legacy snapshots without exact values', () => {
    const before = createTemplateSnapshot({ fixedPriceAmount: 10, fixedPriceAmountExact: undefined })
    const after = createTemplateSnapshot({ fixedPriceAmount: 20, fixedPriceAmountExact: undefined })
    const link = createLinkSnapshot({ fixedPriceAmount: 10, fixedPriceAmountExact: '10' })

    const result = buildSelectiveLinkedLinkSnapshot(link, before, after)

    expect(result.changed).toBe(true)
    expect(result.snapshot.fixedPriceAmount).toBe(20)
    expect(result.snapshot.fixedPriceAmountExact).toBe('20')
  })

  it('keeps syncing price-list items after the link is re-saved with exact amounts', () => {
    const before = createTemplateSnapshot({
      pricingMode: 'price_list',
      priceListItems: [{ id: 'basic', description: 'Basic', amount: 10, currencyCode: 'USD' }],
    })
    const after = createTemplateSnapshot({
      pricingMode: 'price_list',
      priceListItems: [{ id: 'basic', description: 'Basic', amount: 12.5, amountExact: '12.5', currencyCode: 'USD' }],
    })
    const resavedLink = createLinkSnapshot({
      pricingMode: 'price_list',
      priceListItems: [{ id: 'basic', description: 'Basic', amount: 10, amountExact: '10.00', currencyCode: 'USD' }],
    })

    const result = buildSelectiveLinkedLinkSnapshot(resavedLink, before, after)

    expect(result.changed).toBe(true)
    expect(result.snapshot.priceListItems).toEqual(after.priceListItems)
  })

  it('treats price-list items with a different exact amount as a link override', () => {
    const before = createTemplateSnapshot({
      pricingMode: 'price_list',
      priceListItems: [{ id: 'eth', description: 'ETH', amount: 1, amountExact: '1.000000000000000001', currencyCode: 'ETH' }],
    })
    const after = createTemplateSnapshot({
      pricingMode: 'price_list',
      priceListItems: [{ id: 'eth', description: 'ETH', amount: 2, amountExact: '2', currencyCode: 'ETH' }],
    })
    const overriddenLink = createLinkSnapshot({
      pricingMode: 'price_list',
      priceListItems: [{ id: 'eth', description: 'ETH', amount: 1, amountExact: '1.000000000000000002', currencyCode: 'ETH' }],
    })

    const result = buildSelectiveLinkedLinkSnapshot(overriddenLink, before, after)

    expect(result.snapshot.priceListItems).toEqual(overriddenLink.priceListItems)
  })
})
