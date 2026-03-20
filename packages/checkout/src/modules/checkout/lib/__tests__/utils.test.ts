import { clearPaymentGatewayDescriptors, registerPaymentGatewayDescriptor } from '@open-mercato/shared/modules/payment_gateways/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CheckoutLink, CheckoutTransaction } from '../../data/entities'
import {
  applyTerminalTransactionState,
  buildConsentProof,
  pickExplicitParsedOverrides,
  resolveSubmittedAmount,
  serializeTemplateOrLink,
  serializeTransaction,
  signCheckoutAccessToken,
  validateDescriptorCurrencies,
  verifyCheckoutAccessToken,
} from '../utils'

function createLink(overrides: Partial<CheckoutLink> = {}): CheckoutLink {
  const link = new CheckoutLink()
  link.id = 'link_1'
  link.organizationId = 'org_1'
  link.tenantId = 'tenant_1'
  link.name = 'Test link'
  link.slug = 'test-link'
  link.pricingMode = 'fixed'
  link.fixedPriceAmount = '99.99'
  link.fixedPriceCurrencyCode = 'USD'
  link.fixedPriceIncludesTax = true
  link.status = 'active'
  Object.assign(link, overrides)
  return link
}

describe('checkout utils', () => {
  const originalAuthSecret = process.env.AUTH_SECRET

  beforeEach(() => {
    clearPaymentGatewayDescriptors()
    process.env.AUTH_SECRET = 'checkout-test-secret'
  })

  afterAll(() => {
    if (originalAuthSecret == null) {
      delete process.env.AUTH_SECRET
      return
    }
    process.env.AUTH_SECRET = originalAuthSecret
  })

  it('resolves fixed pricing from the server configuration', () => {
    const link = createLink()
    expect(resolveSubmittedAmount(link, {
      customerData: {},
      acceptedLegalConsents: {},
      amount: 99.99,
    })).toEqual({
      amount: 99.99,
      currencyCode: 'USD',
      selectedPriceItemId: null,
    })
  })

  it('rejects fixed pricing when the submitted amount does not match', () => {
    const link = createLink()
    expect(() => resolveSubmittedAmount(link, {
      customerData: {},
      acceptedLegalConsents: {},
      amount: 120,
    })).toThrow(CrudHttpError)
  })

  it('resolves price-list pricing from the selected server-side item', () => {
    const link = createLink({
      pricingMode: 'price_list',
      fixedPriceAmount: null,
      fixedPriceCurrencyCode: null,
      priceListItems: [
        { id: 'vip', description: 'VIP', amount: 149.5, currencyCode: 'EUR' },
        { id: 'standard', description: 'Standard', amount: 99, currencyCode: 'EUR' },
      ],
    })

    expect(resolveSubmittedAmount(link, {
      customerData: {},
      acceptedLegalConsents: {},
      amount: 149.5,
      selectedPriceItemId: 'vip',
    })).toEqual({
      amount: 149.5,
      currencyCode: 'EUR',
      selectedPriceItemId: 'vip',
    })
  })

  it('stores consent proof only for accepted legal documents with markdown', () => {
    const link = createLink({
      legalDocuments: {
        terms: { title: 'Terms', markdown: 'terms body', required: true },
        privacyPolicy: { title: 'Privacy', markdown: 'privacy body', required: false },
      },
    })

    expect(buildConsentProof(link, { terms: true, privacyPolicy: false })).toMatchObject({
      terms: {
        title: 'Terms',
        required: true,
      },
    })
    expect(buildConsentProof(link, { terms: true, privacyPolicy: false })).not.toHaveProperty('privacyPolicy')
  })

  it('verifies password access tokens only for the matching slug', () => {
    const token = signCheckoutAccessToken('launch-offer', {
      linkId: 'link_1',
      passwordHash: '$2b$10$initial-hash',
    })

    expect(verifyCheckoutAccessToken(token, 'launch-offer', {
      linkId: 'link_1',
      passwordHash: '$2b$10$initial-hash',
    })).toBe(true)
    expect(verifyCheckoutAccessToken(token, 'other-link', {
      linkId: 'link_1',
      passwordHash: '$2b$10$initial-hash',
    })).toBe(false)
    expect(verifyCheckoutAccessToken(token, 'launch-offer', {
      linkId: 'link_1',
      passwordHash: '$2b$10$rotated-hash',
    })).toBe(false)
  })

  it('releases the link lock when a reserved transaction reaches a terminal status', () => {
    const link = createLink({
      activeReservationCount: 1,
      completionCount: 0,
      isLocked: true,
      maxCompletions: 1,
    })

    const completedResult = applyTerminalTransactionState(link, 'completed')
    expect(link.activeReservationCount).toBe(0)
    expect(link.completionCount).toBe(1)
    expect(link.isLocked).toBe(false)
    expect(completedResult.usageLimitReached).toBe(true)

    const failedLink = createLink({
      activeReservationCount: 1,
      completionCount: 0,
      isLocked: true,
      maxCompletions: 3,
    })
    const failedResult = applyTerminalTransactionState(failedLink, 'failed')
    expect(failedLink.activeReservationCount).toBe(0)
    expect(failedLink.completionCount).toBe(0)
    expect(failedLink.isLocked).toBe(false)
    expect(failedResult.usageLimitReached).toBe(false)
  })

  it('rejects currencies not supported by the selected gateway descriptor', () => {
    registerPaymentGatewayDescriptor({
      providerKey: 'stripe',
      label: 'Stripe',
      sessionConfig: {
        supportedCurrencies: ['USD', 'EUR'],
      },
    })

    expect(() => validateDescriptorCurrencies('stripe', ['PLN'])).toThrow(CrudHttpError)
    expect(() => validateDescriptorCurrencies('stripe', ['USD'])).not.toThrow()
  })

  it('keeps external logo url separate from attachment preview url when serializing', () => {
    const link = createLink({
      logoAttachmentId: '6e2ba1b0-3f1a-4104-a43a-123456789abc',
      logoUrl: 'https://cdn.example.com/logo.png',
    })

    expect(serializeTemplateOrLink(link)).toMatchObject({
      logoAttachmentId: '6e2ba1b0-3f1a-4104-a43a-123456789abc',
      logoUrl: 'https://cdn.example.com/logo.png',
      logoPreviewUrl:
        '/api/attachments/image/6e2ba1b0-3f1a-4104-a43a-123456789abc?width=640&height=240&cropType=contain',
    })
  })

  it('keeps template values when create-link input only provides explicit overrides', () => {
    expect(pickExplicitParsedOverrides(
      {
        templateId: 'template_1',
        name: 'Community Donation',
        title: 'Community donation',
      },
      {
        templateId: 'template_1',
        name: 'Community Donation',
        title: 'Community donation',
        collectCustomerDetails: true,
        customerFieldsSchema: [{ key: 'email', label: 'Email', kind: 'text', required: true, fixed: true, sortOrder: 0 }],
        displayCustomFieldsOnPage: false,
      },
    )).toEqual({
      templateId: 'template_1',
      name: 'Community Donation',
      title: 'Community donation',
    })
  })

  it('hides user agent when the caller lacks PII access', () => {
    const transaction = new CheckoutTransaction()
    transaction.id = 'txn_1'
    transaction.linkId = 'link_1'
    transaction.amount = '99.99'
    transaction.currencyCode = 'USD'
    transaction.status = 'completed'
    transaction.idempotencyKey = 'idem_1'
    transaction.userAgent = 'Mozilla/5.0'

    expect(serializeTransaction(transaction, null, false).userAgent).toBeNull()
    expect(serializeTransaction(transaction, null, true).userAgent).toBe('Mozilla/5.0')
  })
})
