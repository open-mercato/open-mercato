import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enforceCheckoutRateLimit } from '../../../../lib/rateLimiter'
import { requirePreviewContext } from '../../../helpers'
import { GET } from '../route'

const LINK_ID = '11111111-1111-4111-8111-111111111111'
const LOGO_ID = '33333333-3333-4333-8333-333333333333'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn(async () => ({})),
}))

jest.mock('../../../../lib/customFields', () => ({
  ...jest.requireActual('../../../../lib/customFields'),
  resolveCheckoutPublicCustomFields: jest.fn(async () => []),
}))

jest.mock('../../../../lib/rateLimiter', () => ({
  ...jest.requireActual('../../../../lib/rateLimiter'),
  enforceCheckoutRateLimit: jest.fn(),
}))

jest.mock('../../../helpers', () => ({
  ...jest.requireActual('../../../helpers'),
  requirePreviewContext: jest.fn(),
}))

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    slug: 'donate now',
    name: 'Donate',
    status: 'active',
    passwordHash: null,
    logoAttachmentId: LOGO_ID,
    logoUrl: null,
    pricingMode: 'fixed',
    themeMode: 'auto',
    maxCompletions: null,
    completionCount: 0,
    activeReservationCount: 0,
    tenantId: '44444444-4444-4444-8444-444444444444',
    organizationId: '55555555-5555-4555-8555-555555555555',
    ...overrides,
  }
}

async function readPayload(query = '') {
  const response = await GET(
    new Request(`https://merchant.example/api/checkout/pay/donate%20now${query}`),
    { params: { slug: 'donate now' } },
  )
  expect(response.status).toBe(200)
  return response.json() as Promise<{ logoPreviewUrl: string | null }>
}

describe('GET /api/checkout/pay/[slug] logo URL', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(enforceCheckoutRateLimit).mockResolvedValue(null)
    jest.mocked(requirePreviewContext).mockResolvedValue({} as never)
    jest.mocked(createRequestContainer).mockResolvedValue({ resolve: () => ({}) } as never)
  })

  it('points an anonymous visitor at the public logo route, not the authenticated attachments routes', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(link() as never)

    const payload = await readPayload()

    expect(payload.logoPreviewUrl).toBe('/api/checkout/pay/donate%20now/logo')
  })

  it('keeps the preview flag on the logo URL of a preview', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(link({ status: 'draft' }) as never)

    const payload = await readPayload('?preview=true')

    expect(payload.logoPreviewUrl).toBe('/api/checkout/pay/donate%20now/logo?preview=true')
  })

  it('falls back to the external logo URL when no logo attachment is set', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(
      link({ logoAttachmentId: null, logoUrl: 'https://cdn.example/logo.png' }) as never,
    )

    const payload = await readPayload()

    expect(payload.logoPreviewUrl).toBe('https://cdn.example/logo.png')
  })
})
