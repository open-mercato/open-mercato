import { randomUUID } from 'node:crypto'
import { DefaultPlannerAvailabilityService } from '@open-mercato/core/modules/planner/services/plannerAvailabilityService'
import { GET, metadata } from '../route'

const mockFind = jest.fn()
const mockScope = jest.fn()
const mockFeatures = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (key: string) => {
      if (key === 'rbacService') return { resolveFeatureOrganizationAccess: mockFeatures }
      if (key === 'plannerAvailabilityService') return new DefaultPlannerAvailabilityService()
      return {}
    },
  })),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFind(...args)),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn((...args: unknown[]) => mockScope(...args)),
}))

const tenantId = randomUUID()
const organizationId = randomUUID()
const otherOrganizationId = randomUUID()
const userId = randomUUID()
const memberId = randomUUID()
const auth = { sub: randomUUID(), orgId: organizationId, tenantId }

function request(overrides: Record<string, string> = {}) {
  const query = new URLSearchParams({
    userIds: userId,
    from: '2026-03-08T00:00:00Z',
    to: '2026-03-10T00:00:00Z',
    ...overrides,
  })
  return new Request(`http://localhost/api/staff/availability/windows?${query}`)
}

beforeEach(() => {
  mockScope.mockReset().mockResolvedValue({ tenantId, filterIds: [organizationId, otherOrganizationId] })
  mockFind.mockReset()
  mockFeatures.mockReset().mockImplementation(async (_userId: string, [feature]: string[]) => ({
    filterOrganizationIds: (organizations: Array<{ id: string }>) => organizations
      .filter((organization) => feature === 'customers.interactions.view' && organization.id === organizationId)
      .map((organization) => organization.id),
  }))
})

it('requires Calendar read access and rejects unauthenticated requests', async () => {
  expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['customers.interactions.view'] })
  expect((await GET(request())).status).toBe(401)
  expect(mockFind).not.toHaveBeenCalled()
})

it.each([
  { userIds: 'invalid' },
  { userIds: Array.from({ length: 101 }, () => randomUUID()).join(',') },
  { from: '2026-03-08T00:00:00' },
  { to: '2026-03-08T00:00:00Z' },
  { to: '2026-06-10T00:00:00Z' },
])('rejects invalid input before reading entities', async (overrides) => {
  expect((await GET(request(overrides), { auth })).status).toBe(400)
  expect(mockFind).not.toHaveBeenCalled()
})

it('rejects explicit narrowing outside the authorized scope', async () => {
  mockScope.mockResolvedValue({ tenantId, filterIds: [organizationId] })
  expect((await GET(request({ organizationId: otherOrganizationId }), { auth })).status).toBe(403)
  expect(mockFind).not.toHaveBeenCalled()
})

it('scopes every member-related read and returns only scheduling context to Calendar viewers', async () => {
  mockFind
    .mockResolvedValueOnce([{ id: organizationId }, { id: otherOrganizationId }])
    .mockResolvedValueOnce([{ id: memberId, organizationId, userId }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{
      member: { id: memberId },
      startDate: new Date('2026-03-08'),
      endDate: new Date('2026-03-08'),
      status: 'approved',
      timezone: 'America/New_York',
      organizationId,
      note: 'Private leave note',
      unavailabilityReasonValue: 'Private reason',
    }])
  const response = await GET(request({ userIds: `${userId},${userId}` }), { auth })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    items: [{ userId, organizationId, windows: [{ start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z', kind: 'leave' }] }],
  })
  expect(mockFind.mock.calls[0][2]).toMatchObject({ tenant: tenantId })
  const scopedQueries = mockFind.mock.calls.slice(1).map((call) => call[2])
  expect(scopedQueries).toHaveLength(3)
  for (const query of scopedQueries) {
    expect(query).toMatchObject({ tenantId, organizationId: { $in: [organizationId] }, deletedAt: null })
  }
  expect(scopedQueries[0]).toMatchObject({ isActive: true, userId: { $in: [userId] } })
})

it('discloses reason text only to matching Staff leave readers in that organization', async () => {
  mockFeatures.mockImplementation(async (_userId: string, [feature]: string[]) => ({
    filterOrganizationIds: (organizations: Array<{ id: string }>) => organizations
      .filter((organization) => ['customers.interactions.view', 'staff.leave_requests.manage'].includes(feature)
        && organization.id === organizationId)
      .map((organization) => organization.id),
  }))
  mockFind
    .mockResolvedValueOnce([{ id: organizationId }, { id: otherOrganizationId }])
    .mockResolvedValueOnce([{ id: memberId, organizationId, userId }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{
      member: { id: memberId }, startDate: new Date('2026-03-08'), endDate: new Date('2026-03-08'),
      status: 'pending', timezone: 'UTC', organizationId, note: 'Private note', unavailabilityReasonValue: 'Leave category',
    }])
  const response = await GET(request(), { auth })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    items: [{ userId, organizationId, windows: [{ start: '2026-03-08T00:00:00.000Z', end: '2026-03-09T00:00:00.000Z', kind: 'tentative', reason: 'Leave category' }] }],
  })
})

it('omits members whose assigned rule set is missing in their own organization', async () => {
  const availabilityRuleSetId = randomUUID()
  mockFind
    .mockResolvedValueOnce([{ id: organizationId }])
    .mockResolvedValueOnce([{ id: memberId, organizationId, userId, availabilityRuleSetId }])
    .mockResolvedValueOnce([{ id: availabilityRuleSetId, organizationId: otherOrganizationId }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
  const response = await GET(request(), { auth })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ items: [] })
})

it('withholds self-read reason text when the user has multiple staff profiles in the same organization', async () => {
  const duplicateMemberId = randomUUID()
  mockFeatures.mockImplementation(async (_userId: string, [feature]: string[]) => ({
    filterOrganizationIds: (organizations: Array<{ id: string }>) => organizations
      .filter((organization) => ['customers.interactions.view', 'staff.my_leave_requests.view'].includes(feature)
        && organization.id === organizationId)
      .map((organization) => organization.id),
  }))
  mockFind
    .mockResolvedValueOnce([{ id: organizationId }])
    .mockResolvedValueOnce([
      { id: memberId, organizationId, userId },
      { id: duplicateMemberId, organizationId, userId },
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{
      member: { id: duplicateMemberId }, startDate: new Date('2026-03-08'), endDate: new Date('2026-03-08'),
      status: 'pending', timezone: 'UTC', organizationId, unavailabilityReasonValue: 'Private reason',
    }])
  const response = await GET(request(), { auth: { ...auth, sub: userId } })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    items: [{ userId, organizationId, windows: [{ start: '2026-03-08T00:00:00.000Z', end: '2026-03-09T00:00:00.000Z', kind: 'tentative' }] }],
  })
})
