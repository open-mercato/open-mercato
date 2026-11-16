const getAuthFromRequest = jest.fn()
const lookupCompanyByNip = jest.fn()
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
jest.mock('../lib/lookup', () => ({ lookupCompanyByNip: (...args: unknown[]) => lookupCompanyByNip(...args) }))

import { GET, metadata } from '../api/lookup/route'

type RouteResult = { status: number; body: Record<string, unknown> }
const call = (query: string) => GET(new Request(`http://localhost/api/gus_regon/lookup${query}`)) as unknown as Promise<RouteResult>

beforeEach(() => {
  jest.clearAllMocks()
  getAuthFromRequest.mockResolvedValue({ sub: 'u1', tenantId: 't1', orgId: 'o1' })
  isEnabled.mockResolvedValue(true)
  resolveCredentials.mockResolvedValue({ environment: 'test' })
  lookupCompanyByNip.mockResolvedValue({ ok: false, reason: 'not_found' })
})

describe('GET /api/gus_regon/lookup', () => {
  it('requires auth and the gus_regon.lookup feature', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['gus_regon.lookup'] })
  })

  it('returns 401 without an authenticated tenant', async () => {
    getAuthFromRequest.mockResolvedValue(null)
    await expect(call('?nip=5252344078')).resolves.toMatchObject({ status: 401 })
    expect(lookupCompanyByNip).not.toHaveBeenCalled()
  })

  it('returns 400 without a nip and for a bad checksum, without calling GUS', async () => {
    await expect(call('')).resolves.toMatchObject({ status: 400 })
    await expect(call('?nip=5252344079')).resolves.toMatchObject({ status: 400, body: { error: expect.stringMatching(/checksum/) } })
    expect(lookupCompanyByNip).not.toHaveBeenCalled()
  })

  it('returns not_configured when the integration is disabled for the organization', async () => {
    isEnabled.mockResolvedValue(false)
    await expect(call('?nip=5252344078')).resolves.toEqual({ status: 200, body: { ok: false, reason: 'not_configured' } })
    expect(resolveCredentials).not.toHaveBeenCalled()
    expect(lookupCompanyByNip).not.toHaveBeenCalled()
  })

  it('uses the organization credentials for auth.orgId (same scope as Settings → Integrations)', async () => {
    const company = { nip: '5252344078', regon: '140182840' }
    lookupCompanyByNip.mockResolvedValue({ ok: true, company, candidates: [company] })
    const result = await call('?nip=525-234-40-78')
    expect(result).toEqual({ status: 200, body: { ok: true, company, candidates: [company] } })
    expect(isEnabled).toHaveBeenCalledWith('gus_regon', { organizationId: 'o1', tenantId: 't1' })
    expect(resolveCredentials).toHaveBeenCalledWith('gus_regon', { organizationId: 'o1', tenantId: 't1' })
    expect(lookupCompanyByNip).toHaveBeenCalledWith({ environment: 'test' }, '5252344078')
  })

  it('returns 400 when the user has no organization', async () => {
    getAuthFromRequest.mockResolvedValue({ sub: 'u1', tenantId: 't1', orgId: null })
    await expect(call('?nip=5252344078')).resolves.toMatchObject({ status: 400 })
    expect(lookupCompanyByNip).not.toHaveBeenCalled()
  })

  it('passes fail-open misses through with status 200', async () => {
    lookupCompanyByNip.mockResolvedValue({ ok: false, reason: 'unavailable' })
    await expect(call('?nip=5252344078')).resolves.toEqual({ status: 200, body: { ok: false, reason: 'unavailable' } })
  })

  it('fails open when the integration configuration cannot be read', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    resolveCredentials.mockRejectedValue(new Error('db down: secret-connection-string'))
    const result = await call('?nip=5252344078')
    expect(result).toEqual({ status: 200, body: { ok: false, reason: 'unavailable' } })
    expect(JSON.stringify(result)).not.toContain('secret-connection-string')
    expect(lookupCompanyByNip).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('returns 500 without leaking details when an unexpected error occurs', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    lookupCompanyByNip.mockRejectedValue(new Error('boom: secret-connection-string'))
    const result = await call('?nip=5252344078')
    expect(result).toEqual({ status: 500, body: { error: 'Internal server error' } })
    error.mockRestore()
  })
})
