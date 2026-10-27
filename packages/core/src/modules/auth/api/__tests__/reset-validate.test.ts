/** @jest-environment node */
const mockIsPasswordResetTokenValid = jest.fn()
const mockCheckAuthRateLimit = jest.fn()

const mockContainer = {
  resolve: jest.fn((name: string) => {
    if (name === 'authService') {
      return { isPasswordResetTokenValid: mockIsPasswordResetTokenValid }
    }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: jest.fn((args: unknown) => mockCheckAuthRateLimit(args)),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/config', () => ({
  readEndpointRateLimitConfig: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  rateLimitErrorSchema: {},
}))

import { POST } from '@open-mercato/core/modules/auth/api/reset/validate'

function makeValidateRequest(token: string): Request {
  const body = new URLSearchParams()
  body.set('token', token)
  return new Request('https://app.example.com/api/auth/reset/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

describe('POST /api/auth/reset/validate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null })
  })

  test('reports a live token as valid without consuming it', async () => {
    mockIsPasswordResetTokenValid.mockResolvedValue(true)

    const res = await POST(makeValidateRequest('reset-token-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, valid: true })
    expect(mockIsPasswordResetTokenValid).toHaveBeenCalledWith('reset-token-1')
  })

  test('reports a used or expired token as invalid so the page can render a terminal state', async () => {
    mockIsPasswordResetTokenValid.mockResolvedValue(false)

    const res = await POST(makeValidateRequest('reset-token-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, valid: false })
  })

  test('treats a malformed token as invalid without hitting the auth service', async () => {
    const res = await POST(makeValidateRequest('short'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, valid: false })
    expect(mockIsPasswordResetTokenValid).not.toHaveBeenCalled()
  })

  test('never distinguishes unknown, used, and expired tokens in the response body', async () => {
    mockIsPasswordResetTokenValid.mockResolvedValue(false)

    const res = await POST(makeValidateRequest('reset-token-1'))
    const body = await res.json()

    expect(Object.keys(body).sort()).toEqual(['ok', 'valid'])
  })

  test('rate limits before touching the auth service', async () => {
    const rateLimited = new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 })
    mockCheckAuthRateLimit.mockResolvedValue({ error: rateLimited })

    const res = await POST(makeValidateRequest('reset-token-1'))

    expect(res.status).toBe(429)
    expect(mockIsPasswordResetTokenValid).not.toHaveBeenCalled()
  })
})
