import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutLink } from '../../../../data/entities'
import { enforceCheckoutRateLimit } from '../../../../lib/rateLimiter'
import { GET } from '../route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({ loadCustomFieldValues: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('../../../../lib/customFields', () => ({
  resolveCheckoutPublicCustomFields: jest.fn().mockResolvedValue([]),
}))
jest.mock('../../../../lib/rateLimiter', () => ({
  checkoutPublicViewRateLimitConfig: {},
  enforceCheckoutRateLimit: jest.fn(),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const foreignTenantId = '33333333-3333-4333-8333-333333333333'
const foreignOrganizationId = '44444444-4444-4444-8444-444444444444'
const userHasAllFeatures = jest.fn()
const em = {}
let link: CheckoutLink

function readLink(preview = true) {
  return GET(
    new Request(`https://merchant.example/api/checkout/pay/donate${preview ? '?preview=true' : ''}`),
    { params: { slug: 'donate' } },
  )
}

describe('GET /api/checkout/pay/[slug] preview scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    link = Object.assign(new CheckoutLink(), {
      id: '55555555-5555-4555-8555-555555555555',
      slug: 'donate',
      name: 'Donate',
      title: 'Donate',
      tenantId,
      organizationId,
      pricingMode: 'fixed',
      fixedPriceAmount: '25.00',
      fixedPriceCurrencyCode: 'USD',
      status: 'draft',
      deletedAt: null,
    })
    jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'viewer', tenantId, orgId: organizationId })
    userHasAllFeatures.mockResolvedValue(true)
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: (name: string) => {
        const dependencies: Record<string, unknown> = { em, commandBus: {}, rbacService: { userHasAllFeatures } }
        return dependencies[name]
      },
    } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)
    jest.mocked(findOneWithDecryption).mockImplementation(async (_em, _entity, where) => {
      const filters = where as Record<string, unknown>
      return Object.entries(filters).every(([key, value]) => link[key as keyof CheckoutLink] === value)
        ? link
        : null
    })
    jest.mocked(loadCustomFieldValues).mockResolvedValue({})
    jest.mocked(enforceCheckoutRateLimit).mockResolvedValue(null)
  })

  it.each(['draft', 'inactive', 'active'] as const)('previews a same-scope %s link without its password', async (status) => {
    link.status = status
    link.passwordHash = 'protected-link-hash'

    const response = await readLink()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: link.id, preview: true, available: false, requiresPassword: false })
    expect(userHasAllFeatures).toHaveBeenCalledWith('viewer', ['checkout.view'], { tenantId, organizationId })
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      CheckoutLink,
      { slug: 'donate', deletedAt: null, tenantId, organizationId },
      undefined,
      { tenantId, organizationId },
    )
    expect(enforceCheckoutRateLimit).not.toHaveBeenCalled()
  })

  describe.each([
    ['another tenant', { tenantId: foreignTenantId }],
    ['another organization', { organizationId: foreignOrganizationId }],
  ] as const)('%s', (_description, foreignScope) => {
    it.each(['draft', 'inactive', 'active'] as const)('returns 404 for a protected %s preview', async (status) => {
      Object.assign(link, foreignScope, { status, passwordHash: 'protected-link-hash' })

      const response = await readLink()

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'Payment link not found' })
      expect(loadCustomFieldValues).not.toHaveBeenCalled()
    })
  })

  it.each([
    null,
    { sub: 'viewer', tenantId: null, orgId: organizationId },
    { sub: 'viewer', tenantId, orgId: null },
  ])('rejects a preview without a complete authenticated scope: %j', async (auth) => {
    jest.mocked(getAuthFromRequest).mockResolvedValue(auth)

    const response = await readLink()

    expect(response.status).toBe(401)
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('rejects a preview without checkout.view', async () => {
    userHasAllFeatures.mockResolvedValue(false)

    const response = await readLink()

    expect(response.status).toBe(403)
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })

  it('returns the same 404 for deleted and unknown links', async () => {
    link.deletedAt = new Date()
    expect((await readLink()).status).toBe(404)
    jest.mocked(findOneWithDecryption).mockResolvedValue(null)
    expect((await readLink()).status).toBe(404)
  })

  it('serves an active public link outside the caller scope without authenticating', async () => {
    Object.assign(link, { tenantId: foreignTenantId, organizationId: foreignOrganizationId, status: 'active' })

    const response = await readLink(false)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: link.id, preview: false, requiresPassword: false })
    expect(getAuthFromRequest).not.toHaveBeenCalled()
    expect(enforceCheckoutRateLimit).toHaveBeenCalled()
  })

  it.each(['draft', 'inactive'] as const)('keeps a %s link unavailable to the public', async (status) => {
    link.status = status
    expect((await readLink(false)).status).toBe(404)
  })

  it('keeps the public password gate for an active protected link', async () => {
    Object.assign(link, { tenantId: foreignTenantId, status: 'active', passwordHash: 'protected-link-hash' })

    const response = await readLink(false)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ requiresPassword: true, title: 'Donate' })
    expect(loadCustomFieldValues).not.toHaveBeenCalled()
  })
})
