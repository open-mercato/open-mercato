import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { checkRateLimit } from '@open-mercato/shared/lib/ratelimit/helpers'
import { verifyCheckoutPassword } from '../../../../../lib/utils'
import { POST } from '../route'

const LINK_ID = '11111111-1111-4111-8111-111111111111'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  checkRateLimit: jest.fn(),
  getClientIp: jest.fn(() => '127.0.0.1'),
  RATE_LIMIT_FALLBACK_KEY: 'global',
  RATE_LIMIT_UNAVAILABLE_FALLBACK: 'Service temporarily unavailable. Please try again later.',
}))

jest.mock('../../../../../lib/utils', () => ({
  ...jest.requireActual('../../../../../lib/utils'),
  verifyCheckoutPassword: jest.fn(),
  signCheckoutAccessToken: jest.fn(() => 'signed-token'),
}))

function verifyRequest() {
  return POST(
    new Request('https://merchant.example/api/checkout/pay/donate/verify-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'letmein' }),
    }),
    { params: { slug: 'donate' } },
  )
}

describe('POST /api/checkout/pay/[slug]/verify-password', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(checkRateLimit as jest.Mock).mockResolvedValue(null)
    ;(verifyCheckoutPassword as jest.Mock).mockResolvedValue(true)
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rateLimiterService') return { trustProxyDepth: 0 }
        if (name === 'em') return {}
        throw new Error(`Unknown dependency: ${name}`)
      },
    })
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({
      id: LINK_ID,
      slug: 'donate',
      status: 'active',
      passwordHash: 'hashed',
    })
  })

  it('accepts a correct password when the limiter allows the request', async () => {
    const response = await verifyRequest()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('asks the limiter to fail closed', async () => {
    await verifyRequest()

    expect(checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ failClosed: true }),
    )
  })

  it('returns 503 without verifying the password when the limiter is unavailable', async () => {
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'rateLimiterService') throw new Error('rate limiter unavailable')
        throw new Error(`Unknown dependency: ${name}`)
      },
    })

    const response = await verifyRequest()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Service temporarily unavailable. Please try again later.',
    })
    expect(verifyCheckoutPassword).not.toHaveBeenCalled()
  })

  it('passes a 503 from the limiter straight through', async () => {
    ;(checkRateLimit as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }),
    )

    const response = await verifyRequest()

    expect(response.status).toBe(503)
    expect(verifyCheckoutPassword).not.toHaveBeenCalled()
  })
})
