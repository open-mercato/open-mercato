const getAuthFromRequest = jest.fn()
const createRequestContainer = jest.fn()
const resolveOrganizationScopeForRequest = jest.fn()
const evaluateVisitAvailability = jest.fn()
const visitAvailabilityWarnings = jest.fn()
const query = jest.fn()
const userHasAllFeatures = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequest(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => createRequestContainer(...args),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequest(...args),
}))
jest.mock('../../../lib/visitAvailability', () => {
  const actual = jest.requireActual('../../../lib/visitAvailability')
  return { ...actual, evaluateVisitAvailability: (...args: unknown[]) => evaluateVisitAvailability(...args),
    visitAvailabilityWarnings: () => visitAvailabilityWarnings() }
})

import { GET } from '../route'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333'
const INTERACTION_ID = '44444444-4444-4444-8444-444444444444'
const ENTITY_ID = '55555555-5555-4555-8555-555555555555'

describe('GET visit availability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    visitAvailabilityWarnings.mockReturnValue([])
    getAuthFromRequest.mockResolvedValue({ tenantId: 'tenant', sub: USER_ID })
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: 'organization', allowedIds: ['organization'], tenantId: 'tenant' })
    query.mockResolvedValue({ items: [{ id: INTERACTION_ID, organization_id: 'organization' }], total: 1 })
    userHasAllFeatures.mockResolvedValue(true)
    createRequestContainer.mockResolvedValue({ hasRegistration: () => true, resolve: (name: string) => name === 'queryEngine' ? { query } : { userHasAllFeatures } })
    evaluateVisitAvailability.mockResolvedValue([{ type: 'resource', id: RESOURCE_ID, status: 'available', reasonKey: null }])
  })

  it('rejects malformed intervals before loading scoped data', async () => {
    const response = await GET(new Request('http://localhost/api/example/visit-availability?startAt=bad&endAt=bad'))
    expect(response.status).toBe(400)
    expect(getAuthFromRequest).not.toHaveBeenCalled()
  })

  it('passes bounded subject IDs and authenticated scope to the evaluator', async () => {
    const response = await GET(new Request(`http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z&resourceIds=${RESOURCE_ID}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ subjects: [{ type: 'resource', id: RESOURCE_ID, status: 'available', reasonKey: null }], warnings: [] })
    expect(evaluateVisitAvailability).toHaveBeenCalledWith(expect.objectContaining({ scope: { tenantId: 'tenant', organizationId: 'organization' }, input: expect.objectContaining({ resourceIds: [RESOURCE_ID] }) }))
  })

  it('returns warning keys without failing when availability modules are absent', async () => {
    evaluateVisitAvailability.mockResolvedValue([])
    visitAvailabilityWarnings.mockReturnValue(['example.calendar.visitAvailability.staffDisabled', 'example.calendar.visitAvailability.resourcesDisabled'])
    const response = await GET(new Request('http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ subjects: [], warnings: ['example.calendar.visitAvailability.staffDisabled', 'example.calendar.visitAvailability.resourcesDisabled'] })
  })

  it('accepts a validated edit exclusion and returns named booking failures', async () => {
    evaluateVisitAvailability.mockResolvedValue([{ type: 'resource', id: RESOURCE_ID, displayName: 'Conference room',
      status: 'unavailable', reasonKey: 'example.calendar.visitAvailability.booked' }])
    const response = await GET(new Request(`http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z&excludeInteractionId=${INTERACTION_ID}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ subjects: [{ displayName: 'Conference room', reasonKey: 'example.calendar.visitAvailability.booked' }] })
    expect(evaluateVisitAvailability).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ excludeInteractionId: INTERACTION_ID }) }))
    const invalid = await GET(new Request('http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z&excludeInteractionId=invalid'))
    expect(invalid.status).toBe(400)
  })

  it('evaluates an edited interaction in its authorized parent organization', async () => {
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: 'organization-a', allowedIds: ['organization-a', 'organization-b'], tenantId: 'tenant' })
    query.mockResolvedValue({ items: [{ id: INTERACTION_ID, organization_id: 'organization-b' }], total: 1 })
    const response = await GET(new Request(`http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z&excludeInteractionId=${INTERACTION_ID}`))
    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledWith('customers:customer_interaction', expect.objectContaining({
      tenantId: 'tenant', organizationIds: ['organization-a', 'organization-b'],
      filters: { id: INTERACTION_ID, deleted_at: null },
    }))
    expect(userHasAllFeatures).toHaveBeenCalledWith(USER_ID, ['customers.interactions.manage'], {
      tenantId: 'tenant', organizationId: 'organization-b',
    })
    expect(evaluateVisitAvailability).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: 'tenant', organizationId: 'organization-b' },
    }))
  })

  it('rejects an edited interaction outside the allowed organization set', async () => {
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: 'organization-a', allowedIds: ['organization-a'], tenantId: 'tenant' })
    query.mockResolvedValue({ items: [], total: 0 })
    const response = await GET(new Request(`http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z&excludeInteractionId=${INTERACTION_ID}`))
    expect(response.status).toBe(404)
    expect(evaluateVisitAvailability).not.toHaveBeenCalled()
  })

  it('evaluates a new Visit in the parent entity organization, not the selected one', async () => {
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: 'organization-a', allowedIds: ['organization-a', 'organization-b'], tenantId: 'tenant' })
    query.mockResolvedValue({ items: [{ id: ENTITY_ID, organization_id: 'organization-b' }], total: 1 })
    const response = await GET(new Request(`http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z&entityId=${ENTITY_ID}&staffUserIds=${USER_ID}`))
    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledWith('customers:customer_entity', expect.objectContaining({
      tenantId: 'tenant', organizationIds: ['organization-a', 'organization-b'],
      filters: { id: ENTITY_ID, deleted_at: null },
    }))
    expect(userHasAllFeatures).toHaveBeenCalledWith(USER_ID, ['customers.interactions.manage'], {
      tenantId: 'tenant', organizationId: 'organization-b',
    })
    expect(evaluateVisitAvailability).toHaveBeenCalledWith(expect.objectContaining({
      scope: { tenantId: 'tenant', organizationId: 'organization-b' },
    }))
  })

  it('prefers the edited interaction over the parent entity when both are supplied', async () => {
    query.mockResolvedValue({ items: [{ id: INTERACTION_ID, organization_id: 'organization' }], total: 1 })
    const response = await GET(new Request(`http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z&entityId=${ENTITY_ID}&excludeInteractionId=${INTERACTION_ID}`))
    expect(response.status).toBe(200)
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith('customers:customer_interaction', expect.anything())
  })

  it('rejects a parent entity outside the allowed organization set', async () => {
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: 'organization-a', allowedIds: ['organization-a'], tenantId: 'tenant' })
    query.mockResolvedValue({ items: [], total: 0 })
    const response = await GET(new Request(`http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z&entityId=${ENTITY_ID}`))
    expect(response.status).toBe(404)
    expect(evaluateVisitAvailability).not.toHaveBeenCalled()
  })

  it('rejects a malformed parent entity id', async () => {
    const response = await GET(new Request('http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z&entityId=not-a-uuid'))
    expect(response.status).toBe(400)
    expect(evaluateVisitAvailability).not.toHaveBeenCalled()
  })

  it('rejects a user without interaction management access', async () => {
    userHasAllFeatures.mockResolvedValue(false)
    const response = await GET(new Request('http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z'))
    expect(response.status).toBe(403)
    expect(evaluateVisitAvailability).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated preview before resolving organization scope', async () => {
    getAuthFromRequest.mockResolvedValue(null)
    const response = await GET(new Request('http://localhost/api/example/visit-availability?startAt=2026-10-05T09%3A00%3A00Z&endAt=2026-10-05T10%3A00%3A00Z'))
    expect(response.status).toBe(401)
    expect(resolveOrganizationScopeForRequest).not.toHaveBeenCalled()
  })
})
