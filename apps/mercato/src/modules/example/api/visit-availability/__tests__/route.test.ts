const resolveCustomersRequestContext = jest.fn()
const evaluateVisitAvailability = jest.fn()

jest.mock('@open-mercato/core/modules/customers/lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: (...args: unknown[]) => resolveCustomersRequestContext(...args),
  resolveAuthActorId: () => '11111111-1111-4111-8111-111111111111',
}))
jest.mock('../../../lib/visitAvailability', () => {
  const actual = jest.requireActual('../../../lib/visitAvailability')
  return { ...actual, evaluateVisitAvailability: (...args: unknown[]) => evaluateVisitAvailability(...args) }
})

import { GET } from '../route'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333'

describe('GET visit availability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolveCustomersRequestContext.mockResolvedValue({
      auth: { tenantId: 'tenant', sub: USER_ID }, selectedOrganizationId: 'organization',
      container: { hasRegistration: () => true, resolve: () => ({ userHasAllFeatures: async () => true }) },
    })
    evaluateVisitAvailability.mockResolvedValue([{ type: 'resource', id: RESOURCE_ID, status: 'available', reasonKey: null }])
  })

  it('rejects malformed intervals before loading scoped data', async () => {
    const response = await GET(new Request('http://localhost/api/example/visit-availability?startAt=bad&endAt=bad'))
    expect(response.status).toBe(400)
    expect(resolveCustomersRequestContext).not.toHaveBeenCalled()
  })

  it('passes bounded subject IDs and authenticated scope to the evaluator', async () => {
    const response = await GET(new Request(`http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z&resourceIds=${RESOURCE_ID}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ subjects: [{ type: 'resource', id: RESOURCE_ID, status: 'available', reasonKey: null }] })
    expect(evaluateVisitAvailability).toHaveBeenCalledWith(expect.objectContaining({ scope: { tenantId: 'tenant', organizationId: 'organization' }, input: expect.objectContaining({ resourceIds: [RESOURCE_ID] }) }))
  })

  it('rejects a user without interaction management access', async () => {
    resolveCustomersRequestContext.mockResolvedValue({
      auth: { tenantId: 'tenant', sub: USER_ID }, selectedOrganizationId: 'organization',
      container: { hasRegistration: () => true, resolve: () => ({ userHasAllFeatures: async () => false }) },
    })
    const response = await GET(new Request('http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z'))
    expect(response.status).toBe(403)
    expect(evaluateVisitAvailability).not.toHaveBeenCalled()
  })
})
