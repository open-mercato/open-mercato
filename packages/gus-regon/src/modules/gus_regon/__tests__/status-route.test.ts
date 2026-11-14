const getAuthFromRequest = jest.fn()
const isEnabled = jest.fn()
const resolveCredentials = jest.fn()

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }),
  },
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: (...args: unknown[]) => getAuthFromRequest(...args) }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => {
      if (name === 'integrationStateService') return { isEnabled }
      if (name === 'integrationCredentialsService') return { resolve: resolveCredentials }
      throw new Error(`unexpected service ${name}`)
    },
  }),
}))

import { GET, metadata } from '../api/status/route'

type RouteResult = { status: number; body: Record<string, unknown> }
const call = () => GET(new Request('http://localhost/api/gus_regon/status')) as unknown as Promise<RouteResult>

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequest.mockResolvedValue({ sub: 'u1', tenantId: 't1', orgId: 'o1' })
  isEnabled.mockResolvedValue(true)
  resolveCredentials.mockResolvedValue({ environment: 'production', apiKey: 'super-secret', showOnCompanyForms: true })
})

describe('GET /api/gus_regon/status', () => {
  it('requires auth and the gus_regon.lookup feature', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['gus_regon.lookup'] })
  })

  it('returns 401 without an authenticated tenant and 400 without an organization', async () => {
    getAuthFromRequest.mockResolvedValueOnce(null)
    await expect(call()).resolves.toMatchObject({ status: 401 })
    getAuthFromRequest.mockResolvedValueOnce({ sub: 'u1', tenantId: 't1', orgId: null })
    await expect(call()).resolves.toMatchObject({ status: 400 })
  })

  it('returns booleans for auth.orgId and never the key', async () => {
    const result = await call()
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      enabled: true,
      environment: 'production',
      hasApiKey: true,
      lookupAvailable: true,
      companyFormsRequested: true,
      companyFormsActive: true,
    })
    expect(JSON.stringify(result.body)).not.toContain('super-secret')
    expect(resolveCredentials).toHaveBeenCalledWith('gus_regon', { organizationId: 'o1', tenantId: 't1' })
  })

  it('returns 500 without details on unexpected errors', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    resolveCredentials.mockRejectedValue(new Error('db down'))
    await expect(call()).resolves.toEqual({ status: 500, body: { error: 'Internal server error' } })
    error.mockRestore()
  })
})
