import type { EntityManager } from '@mikro-orm/postgresql'
import { clearPaymentGatewayDescriptors, registerPaymentGatewayDescriptor } from '@open-mercato/shared/modules/payment_gateways/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CheckoutLink, CheckoutTransaction } from '../../data/entities'
import {
  applyTerminalTransactionState,
  buildConsentProof,
  ensureUniqueSlug,
  getCheckoutCustomerFieldSemanticType,
  pickExplicitParsedOverrides,
  resolveLoadedCheckoutCustomFields,
  resolveSubmittedAmount,
  serializeTemplateOrLink,
  serializeTransaction,
  signCheckoutAccessToken,
  validateCheckoutCustomerData,
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
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET
  const originalJwtSecret = process.env.JWT_SECRET
  const originalTenantEncryptionFallbackKey = process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY

  beforeEach(() => {
    clearPaymentGatewayDescriptors()
    process.env.AUTH_SECRET = 'checkout-test-secret'
    delete process.env.NEXTAUTH_SECRET
    delete process.env.JWT_SECRET
    delete process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
  })

  afterAll(() => {
    if (originalAuthSecret == null) {
      delete process.env.AUTH_SECRET
    } else {
      process.env.AUTH_SECRET = originalAuthSecret
    }
    if (originalNextAuthSecret == null) {
      delete process.env.NEXTAUTH_SECRET
    } else {
      process.env.NEXTAUTH_SECRET = originalNextAuthSecret
    }
    if (originalJwtSecret == null) {
      delete process.env.JWT_SECRET
    } else {
      process.env.JWT_SECRET = originalJwtSecret
    }
    if (originalTenantEncryptionFallbackKey == null) {
      delete process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY
    } else {
      process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = originalTenantEncryptionFallbackKey
    }
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

  it('ensures slug uniqueness globally even when another tenant already uses the requested slug', async () => {
    const findOne = jest
      .fn()
      .mockResolvedValueOnce({ id: 'other-tenant-link', slug: 'shared-slug' })
      .mockResolvedValueOnce(null)

    const slug = await ensureUniqueSlug(
      { findOne } as unknown as EntityManager,
      { tenantId: 'tenant_2', organizationId: 'org_2' },
      'shared-slug',
      'Shared slug',
    )

    expect(slug).toBe('shared-slug-2')
    expect(findOne).toHaveBeenNthCalledWith(1, CheckoutLink, {
      slug: 'shared-slug',
      deletedAt: null,
    })
    expect(findOne).toHaveBeenNthCalledWith(2, CheckoutLink, {
      slug: 'shared-slug-2',
      deletedAt: null,
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
      sessionVersion: '2026-03-20T10:00:00.000Z',
    })

    expect(verifyCheckoutAccessToken(token, 'launch-offer', {
      linkId: 'link_1',
      sessionVersion: '2026-03-20T10:00:00.000Z',
    })).toBe(true)
    expect(verifyCheckoutAccessToken(token, 'other-link', {
      linkId: 'link_1',
      sessionVersion: '2026-03-20T10:00:00.000Z',
    })).toBe(false)
    expect(verifyCheckoutAccessToken(token, 'launch-offer', {
      linkId: 'link_1',
      sessionVersion: '2026-03-20T10:05:00.000Z',
    })).toBe(false)
  })

  it('falls back to JWT_SECRET for checkout password sessions', () => {
    delete process.env.AUTH_SECRET
    process.env.JWT_SECRET = 'checkout-jwt-secret'

    const token = signCheckoutAccessToken('launch-offer', {
      linkId: 'link_1',
      sessionVersion: '2026-03-20T10:00:00.000Z',
    })

    expect(verifyCheckoutAccessToken(token, 'launch-offer', {
      linkId: 'link_1',
      sessionVersion: '2026-03-20T10:00:00.000Z',
    })).toBe(true)
  })

  it('falls back to TENANT_DATA_ENCRYPTION_FALLBACK_KEY when auth secrets are unset', () => {
    delete process.env.AUTH_SECRET
    delete process.env.JWT_SECRET
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY = 'checkout-encryption-fallback-secret'

    const token = signCheckoutAccessToken('launch-offer', {
      linkId: 'link_1',
      sessionVersion: '2026-03-20T10:00:00.000Z',
    })

    expect(verifyCheckoutAccessToken(token, 'launch-offer', {
      linkId: 'link_1',
      sessionVersion: '2026-03-20T10:00:00.000Z',
    })).toBe(true)
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

  it('serializes link-only fields even when the record is a plain object', () => {
    const link = {
      ...createLink({
        templateId: 'template_1',
        completionCount: 1,
        activeReservationCount: 2,
        isLocked: true,
      }),
    } as CheckoutLink

    expect(serializeTemplateOrLink(link)).toMatchObject({
      slug: 'test-link',
      templateId: 'template_1',
      completionCount: 1,
      activeReservationCount: 2,
      isLocked: true,
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

  it('normalizes loaded checkout custom fields back to bare keys', () => {
    expect(resolveLoadedCheckoutCustomFields({
      cf_support_contact: 'team@example.com',
      cf_impact_summary: 'Supports workshops',
    })).toEqual({
      support_contact: 'team@example.com',
      impact_summary: 'Supports workshops',
    })
  })

  it('validates malformed email and phone customer data', () => {
    expect(getCheckoutCustomerFieldSemanticType({ key: 'email' })).toBe('email')
    expect(getCheckoutCustomerFieldSemanticType({ key: 'companyPhone' })).toBe('phone')

    expect(validateCheckoutCustomerData(
      [
        { key: 'email', kind: 'text', required: true },
        { key: 'phone', kind: 'text', required: false },
      ],
      {
        email: 'invalid-email',
        phone: 'wrong phone number',
      },
    )).toEqual({
      'customerData.email': 'checkout.payPage.validation.invalidEmail',
      'customerData.phone': 'checkout.payPage.validation.invalidPhone',
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
