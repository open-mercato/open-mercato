import {
  buildSelectiveLinkedCustomFieldUpdates,
  buildSelectiveLinkedLinkSnapshot,
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
    fixedPriceCurrencyCode: 'USD',
    fixedPriceIncludesTax: true,
    fixedPriceOriginalAmount: 69.99,
    customAmountMin: null,
    customAmountMax: null,
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
})
