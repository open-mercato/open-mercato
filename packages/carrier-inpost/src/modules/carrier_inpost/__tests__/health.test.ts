import Chance from 'chance'
import { inpostHealthCheck } from '../lib/health'

const chance = new Chance()

describe('inpostHealthCheck.check', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('returns healthy when the organization endpoint responds successfully', async () => {
    const orgId = chance.guid()
    const orgName = chance.company()
    const credentials = { apiToken: chance.guid(), organizationId: orgId }

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: orgId, name: orgName }),
    })

    const result = await inpostHealthCheck.check(credentials)

    expect(result.status).toBe('healthy')
    expect(result.message).toBe(`Connected to InPost organization ${orgId}`)
    expect(result.details).toEqual({ organizationId: orgId, organizationName: orgName })
    expect(result.checkedAt).toBeInstanceOf(Date)
  })

  it('sets organizationName to null when org has no name field', async () => {
    const orgId = chance.guid()
    const credentials = { apiToken: chance.guid(), organizationId: orgId }

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: orgId }),
    })

    const result = await inpostHealthCheck.check(credentials)

    expect(result.status).toBe('healthy')
    expect(result.details.organizationName).toBeNull()
  })

  it('returns unhealthy when the API responds with a non-ok status', async () => {
    const credentials = { apiToken: chance.guid(), organizationId: chance.guid() }
    const statusCode = chance.pickone([401, 403, 404, 500])

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: statusCode,
      text: () => Promise.resolve(chance.sentence()),
    })

    const result = await inpostHealthCheck.check(credentials)

    expect(result.status).toBe('unhealthy')
    expect(result.message).toContain('InPost connection failed')
    expect(result.message).toContain(String(statusCode))
    expect(result.checkedAt).toBeInstanceOf(Date)
  })

  it('returns unhealthy when organizationId is missing from credentials', async () => {
    const result = await inpostHealthCheck.check({ apiToken: chance.guid() })

    expect(result.status).toBe('unhealthy')
    expect(result.message).toContain('InPost organization ID is required')
    expect(result.details.error).toBe('InPost organization ID is required')
  })

  it('returns unhealthy when apiToken is missing from credentials', async () => {
    const result = await inpostHealthCheck.check({ organizationId: chance.guid() })

    expect(result.status).toBe('unhealthy')
    expect(result.message).toContain('InPost API token is required')
  })

  it('reports "Unknown error" in details when a non-Error is thrown', async () => {
    const credentials = { apiToken: chance.guid(), organizationId: chance.guid() }

    global.fetch = jest.fn().mockRejectedValue(chance.sentence())

    const result = await inpostHealthCheck.check(credentials)

    expect(result.status).toBe('unhealthy')
    expect(result.details.error).toBe('Unknown error')
  })
})
