/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/auth/api/feature-check'

// Mock auth
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

// Mock DI
const mockRbac = { userHasAllFeatures: jest.fn() }
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (k: string) => (k === 'rbacService' ? mockRbac : null) }),
}))

function makeReq(body: any) {
  return new Request('http://localhost/api/auth/feature-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/feature-check', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRbac.userHasAllFeatures.mockResolvedValue(true)
  })

  it('returns 401 when not authenticated', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockReturnValue(null)
    const res = await POST(makeReq({ features: ['x.y'] }))
    expect(res.status).toBe(401)
  })

  it('returns ok true when no features passed', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockReturnValue({ sub: 'u1', tenantId: 't1', orgId: 'o1' })
    const res = await POST(makeReq({ features: [] }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, granted: [], userId: 'u1' })
  })

  it('returns ok true when RBAC grants all features', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockReturnValue({ sub: 'u1', tenantId: 't1', orgId: 'o1' })
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(true)
    const res = await POST(makeReq({ features: ['a.b'] }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, granted: ['a.b'], userId: 'u1' })
  })

  it('returns ok false when RBAC denies features', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockReturnValue({ sub: 'u1', tenantId: 't1', orgId: 'o1' })
    mockRbac.userHasAllFeatures.mockResolvedValueOnce(false)
    const res = await POST(makeReq({ features: ['a.b'] }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(Array.isArray(data.granted)).toBe(true)
  })
})


