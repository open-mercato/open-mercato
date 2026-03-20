import { clearPaymentGatewayDescriptors, registerPaymentGatewayDescriptor } from '@open-mercato/shared/modules/payment_gateways/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CheckoutLink } from '../../data/entities'
import {
  buildConsentProof,
  resolveSubmittedAmount,
  serializeTemplateOrLink,
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
    const token = signCheckoutAccessToken('launch-offer')

    expect(verifyCheckoutAccessToken(token, 'launch-offer')).toBe(true)
    expect(verifyCheckoutAccessToken(token, 'other-link')).toBe(false)
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
})
