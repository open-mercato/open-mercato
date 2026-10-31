import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLink } from '../../../../data/entities'
import { resolveCheckoutPublicCustomFields } from '../../../../lib/customFields'
import { serializeTemplateOrLink, signCheckoutAccessToken } from '../../../../lib/utils'
import { readCheckoutAccessCookie, requirePreviewContext } from '../../../helpers'
import { GET } from '../route'

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../../../../lib/customFields', () => ({
  resolveCheckoutPublicCustomFields: jest.fn(),
}))

jest.mock('../../../../lib/rateLimiter', () => ({
  enforceCheckoutRateLimit: jest.fn().mockResolvedValue(null),
}))

jest.mock('../../../helpers', () => ({
  ...jest.requireActual('../../../helpers'),
  readCheckoutAccessCookie: jest.fn(),
  requirePreviewContext: jest.fn(),
}))

function createLink(): CheckoutLink {
  return Object.assign(new CheckoutLink(), {
    id: '11111111-1111-4111-8111-111111111111',
    tenantId: 'tenant_1',
    organizationId: 'org_1',
    slug: 'donate',
    name: 'Donation',
    title: 'Support our work',
    status: 'active' as const,
    pricingMode: 'fixed' as const,
    fixedPriceAmount: '49.99',
    fixedPriceCurrencyCode: 'USD',
    fixedPriceIncludesTax: true,
    fixedPriceOriginalAmount: '69.99',
    customAmountMin: '10.00',
    customAmountMax: '100.00',
    customAmountCurrencyCode: 'EUR',
    priceListItems: [{ id: 'standard', description: 'Standard', amount: 49.99, currencyCode: 'USD' }],
    logoAttachmentId: '22222222-2222-4222-8222-222222222222',
    logoUrl: 'https://merchant.example/logo.png',
    gatewayProviderKey: 'mock',
    gatewaySettings: { privateSetting: 'admin-only-value' },
    customFieldsetCode: 'internal-fieldset',
    customerFieldsSchema: [{ key: 'email', label: 'Email', kind: 'email', required: true }],
    legalDocuments: { terms: { title: 'Terms', markdown: 'Terms body', required: true } },
    displayCustomFieldsOnPage: true,
    successTitle: 'Thank you',
    successMessage: 'Payment received',
    cancelTitle: 'Cancelled',
    cancelMessage: 'Payment cancelled',
    errorTitle: 'Try again',
    errorMessage: 'Payment failed',
    successEmailSubject: 'Private success subject',
    successEmailBody: 'Private success body',
    errorEmailSubject: 'Private error subject',
    errorEmailBody: 'Private error body',
    startEmailSubject: 'Private start subject',
    startEmailBody: 'Private start body',
    maxCompletions: 10,
    completionCount: 2,
    activeReservationCount: 1,
    templateId: 'template_1',
    isLocked: true,
    futureAdminField: 'must never be public',
  })
}

function expectedPublicResponse(link: CheckoutLink) {
  return {
    id: link.id,
    slug: 'donate',
    name: 'Donation',
    title: 'Support our work',
    subtitle: null,
    description: null,
    logoUrl: 'https://merchant.example/logo.png',
    logoPreviewUrl: '/api/attachments/image/22222222-2222-4222-8222-222222222222?width=640&height=240&cropType=contain',
    primaryColor: null,
    secondaryColor: null,
    backgroundColor: null,
    themeMode: 'auto',
    pricingMode: 'fixed',
    fixedPriceAmount: 49.99,
    fixedPriceCurrencyCode: 'USD',
    fixedPriceIncludesTax: true,
    fixedPriceOriginalAmount: 69.99,
    customAmountMin: 10,
    customAmountMax: 100,
    customAmountCurrencyCode: 'EUR',
    priceListItems: link.priceListItems,
    gatewayProviderKey: 'mock',
    collectCustomerDetails: true,
    customerFieldsSchema: link.customerFieldsSchema,
    legalDocuments: link.legalDocuments,
    displayCustomFieldsOnPage: true,
    successTitle: 'Thank you',
    successMessage: 'Payment received',
    cancelTitle: 'Cancelled',
    cancelMessage: 'Payment cancelled',
    errorTitle: 'Try again',
    errorMessage: 'Payment failed',
    status: link.status,
    checkoutType: 'pay_link',
    publicCustomFields: [{ key: 'campaign', label: 'Campaign', value: 'Community', kind: 'text', multi: false }],
    available: true,
    remainingUses: 7,
    requiresPassword: false,
    preview: false,
  }
}

function readPayPage(query = '') {
  return GET(new Request(`https://merchant.example/api/checkout/pay/donate${query}`), {
    params: Promise.resolve({ slug: 'donate' }),
  })
}

describe('GET /api/checkout/pay/[slug] public response', () => {
  const originalAuthSecret = process.env.AUTH_SECRET
  let link: ReturnType<typeof createLink>

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.AUTH_SECRET = 'checkout-public-response-test-secret'
    link = createLink()
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: () => ({}),
    } as Awaited<ReturnType<typeof createRequestContainer>>)
    jest.mocked(findOneWithDecryption).mockResolvedValue(link)
    jest.mocked(loadCustomFieldValues).mockResolvedValue({ [link.id]: {} })
    jest.mocked(resolveCheckoutPublicCustomFields).mockResolvedValue([
      { key: 'campaign', label: 'Campaign', value: 'Community', kind: 'text', multi: false },
    ])
    jest.mocked(readCheckoutAccessCookie).mockReturnValue(null)
    jest.mocked(requirePreviewContext).mockResolvedValue({} as Awaited<ReturnType<typeof requirePreviewContext>>)
  })

  afterAll(() => {
    if (originalAuthSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = originalAuthSecret
  })

  it('returns only the public allowlist for an unauthenticated payer', async () => {
    const response = await readPayPage()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expectedPublicResponse(link))
  })

  it('keeps the password challenge minimal and does not load custom fields', async () => {
    link.passwordHash = 'password-session-version'

    const response = await readPayPage()

    expect(await response.json()).toEqual({ requiresPassword: true, title: 'Support our work' })
    expect(loadCustomFieldValues).not.toHaveBeenCalled()
    expect(resolveCheckoutPublicCustomFields).not.toHaveBeenCalled()
  })

  it('returns the same public allowlist after password verification', async () => {
    link.passwordHash = 'password-session-version'
    jest.mocked(readCheckoutAccessCookie).mockReturnValue(signCheckoutAccessToken(link.slug, {
      linkId: link.id,
      sessionVersion: link.passwordHash,
    }))

    const response = await readPayPage()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expectedPublicResponse(link))
  })

  it('does not accept a password session for a different slug', async () => {
    link.passwordHash = 'password-session-version'
    jest.mocked(readCheckoutAccessCookie).mockReturnValue(signCheckoutAccessToken('other-link', {
      linkId: link.id,
      sessionVersion: link.passwordHash,
    }))

    const response = await readPayPage()

    expect(await response.json()).toEqual({ requiresPassword: true, title: 'Support our work' })
  })

  it('uses the public allowlist for authorized draft previews with payments disabled', async () => {
    link.status = 'draft'
    link.passwordHash = 'password-session-version'

    const response = await readPayPage('?preview=true')

    expect(requirePreviewContext).toHaveBeenCalled()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...expectedPublicResponse(link), available: false, preview: true })
  })

  it('still requires admin authorization for previews', async () => {
    jest.mocked(requirePreviewContext).mockRejectedValue(new CrudHttpError(401, { error: 'Unauthorized' }))

    const response = await readPayPage('?preview=true')

    expect(response.status).toBe(401)
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('preserves unlimited availability without exposing raw usage counters', async () => {
    link.maxCompletions = null

    const response = await readPayPage()

    expect(await response.json()).toEqual({ ...expectedPublicResponse(link), remainingUses: null })
  })

  it('keeps email and management fields in the administrative serializer', () => {
    expect(serializeTemplateOrLink(link)).toMatchObject({
      successEmailSubject: link.successEmailSubject,
      successEmailBody: link.successEmailBody,
      errorEmailSubject: link.errorEmailSubject,
      errorEmailBody: link.errorEmailBody,
      startEmailSubject: link.startEmailSubject,
      startEmailBody: link.startEmailBody,
      sendSuccessEmail: true,
      sendErrorEmail: true,
      sendStartEmail: true,
      gatewaySettings: link.gatewaySettings,
      logoAttachmentId: link.logoAttachmentId,
      customFieldsetCode: link.customFieldsetCode,
      templateId: link.templateId,
      maxCompletions: 10,
      completionCount: 2,
      activeReservationCount: 1,
      isLocked: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
  })
})
