import { inpostHealthCheck } from '../lib/health'

describe('inpostHealthCheck.check', () => {
  const credentials = { apiToken: 'tok', organizationId: 'org-1' }

  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns healthy when the organization endpoint responds successfully', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'org-1', name: 'Acme Logistics' }),
    })
    global.fetch = mockFetch

    const result = await inpostHealthCheck.check(credentials)

    expect(result.status).toBe('healthy')
    expect(result.message).toBe('Connected to InPost organization org-1')
    expect(result.details).toEqual({ organizationId: 'org-1', organizationName: 'Acme Logistics' })
    expect(result.checkedAt).toBeInstanceOf(Date)
  })

  it('sets organizationName to null when org has no name field', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'org-1' }),
    })
    global.fetch = mockFetch

    const result = await inpostHealthCheck.check(credentials)

    expect(result.status).toBe('healthy')
    expect(result.details.organizationName).toBeNull()
  })

  it('returns unhealthy when the API responds with a non-ok status', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    })
    global.fetch = mockFetch

    const result = await inpostHealthCheck.check(credentials)

    expect(result.status).toBe('unhealthy')
    expect(result.message).toContain('InPost connection failed')
    expect(result.message).toContain('401')
    expect(result.checkedAt).toBeInstanceOf(Date)
  })

  it('returns unhealthy when organizationId is missing from credentials', async () => {
    const result = await inpostHealthCheck.check({ apiToken: 'tok' })

    expect(result.status).toBe('unhealthy')
    expect(result.message).toContain('InPost organization ID is required')
    expect(result.details.error).toBe('InPost organization ID is required')
  })

  it('returns unhealthy when apiToken is missing from credentials', async () => {
    const result = await inpostHealthCheck.check({ organizationId: 'org-1' })

    expect(result.status).toBe('unhealthy')
    expect(result.message).toContain('InPost API token is required')
  })

  it('reports "Unknown error" in details when a non-Error is thrown', async () => {
    const mockFetch = jest.fn().mockRejectedValue('string error')
    global.fetch = mockFetch

    const result = await inpostHealthCheck.check(credentials)

    expect(result.status).toBe('unhealthy')
    expect(result.details.error).toBe('Unknown error')
  })
})
