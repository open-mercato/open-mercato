import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { GET as getProfile } from '../../profile/sign-ins/route'
import { GET as getDetail } from '../[id]/route'
import { GET as getList } from '../route'
import { buildAdminSignInFilter } from '../_shared'
import { adminSignInQuerySchema, profileSignInQuerySchema } from '../../../data/sign-in-query-validators'

const tenantId = '4e6937af-baa0-452b-b8a0-2df2bcdd46c2'
const organizationId = '8de689dc-0dcf-47b2-9def-a1258898e691'
const userId = 'b718673c-d7d3-465a-a12e-765ff2b93c15'
const attemptId = '20a412f6-4bef-4d61-81e9-17f2bd581271'

const mockAuth = jest.fn()
const mockFind = jest.fn()
const mockFindOne = jest.fn()
const mockFindAndCount = jest.fn()
const mockScope = jest.fn()
const originalEnabled = process.env.OM_SECURITY_SIGN_IN_ACTIVITY
const originalRetentionDays = process.env.OM_SECURITY_SIGN_IN_RETENTION_DAYS

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockAuth(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: () => ({}) }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFind(...args),
  findOneWithDecryption: (...args: unknown[]) => mockFindOne(...args),
  findAndCountWithDecryption: (...args: unknown[]) => mockFindAndCount(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockScope(...args),
}))

function request(path: string) {
  return new Request(`https://example.test/api/security/${path}`)
}

beforeEach(() => {
  jest.resetAllMocks()
  process.env.OM_SECURITY_SIGN_IN_ACTIVITY = 'true'
  process.env.OM_SECURITY_SIGN_IN_RETENTION_DAYS = '90'
  mockAuth.mockResolvedValue({ tenantId, sub: userId, orgId: organizationId })
  mockScope.mockResolvedValue({ tenantId, filterIds: [organizationId], allowedIds: [organizationId] })
  mockFind.mockResolvedValue([])
  mockFindOne.mockResolvedValue(null)
  mockFindAndCount.mockResolvedValue([[], 0])
})

afterAll(() => {
  if (originalEnabled === undefined) delete process.env.OM_SECURITY_SIGN_IN_ACTIVITY
  else process.env.OM_SECURITY_SIGN_IN_ACTIVITY = originalEnabled
  if (originalRetentionDays === undefined) delete process.env.OM_SECURITY_SIGN_IN_RETENTION_DAYS
  else process.env.OM_SECURITY_SIGN_IN_RETENTION_DAYS = originalRetentionDays
})

test('maps private input filters to lookup hashes and combines all scope clauses', () => {
  const from = '2026-11-22T00:00:00Z'
  const to = '2026-11-24T00:00:00Z'
  const query = adminSignInQuerySchema.parse({ userId, result: 'failure', email: 'Staff@Example.test', ip: '203.0.113.7', from, to })
  expect(buildAdminSignInFilter(tenantId, [organizationId], query)).toEqual({
    tenantId,
    userId,
    result: 'failure',
    emailHash: { $in: lookupHashCandidates('staff@example.test') },
    ipHash: { $in: lookupHashCandidates('203.0.113.7') },
    occurredAt: { $gte: new Date(from), $lte: new Date(to) },
    $or: [{ organizationId: null }, { organizationId: { $in: [organizationId] } }],
  })
})

test.each([
  { ip: 'invalid' }, { pageSize: '101' },
  { from: '2026-11-22T00:00:00Z', to: '2026-11-21T00:00:00Z' },
  { from: '2024-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
])('rejects invalid admin filters %#', (query) => {
  expect(adminSignInQuerySchema.safeParse(query).success).toBe(false)
})

test('the admin list constrains SQL and translates pagination', async () => {
  const response = await getList(request('sign-ins?page=2&pageSize=10&sort=occurredAt:asc'))
  expect(response.status).toBe(200)
  expect(mockFindAndCount).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
    tenantId, $or: [{ organizationId: null }, { organizationId: { $in: [organizationId] } }],
  }, { limit: 10, offset: 10, orderBy: { occurredAt: 'asc', id: 'asc' } }, { tenantId })
  expect(await response.json()).toEqual({ items: [], total: 0, page: 2, pageSize: 10, totalPages: 0 })
})

test('admin list rejects an authorization scope for a different tenant', async () => {
  mockScope.mockResolvedValue({ tenantId: attemptId, filterIds: null, allowedIds: null })
  const response = await getList(request('sign-ins'))
  expect(response.status).toBe(403)
  expect(mockFindAndCount).not.toHaveBeenCalled()
})

test('detail returns the same 404 for unavailable or out-of-scope rows', async () => {
  const response = await getDetail(request(`sign-ins/${attemptId}`), { params: Promise.resolve({ id: attemptId }) })
  expect(response.status).toBe(404)
  expect(mockFindOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
    id: attemptId, tenantId, $or: [{ organizationId: null }, { organizationId: { $in: [organizationId] } }],
  }, undefined, { tenantId })
})

test('detail resolves previous success in the same tenant and permitted organizations', async () => {
  const occurredAt = new Date('2026-11-23T08:00:00Z')
  const previous = new Date('2026-11-22T08:00:00Z')
  mockFindOne.mockResolvedValueOnce({
    id: attemptId, userId, email: 'staff@example.test', organizationId, occurredAt,
    result: 'success', deviceType: 'desktop', isNewDevice: false,
  }).mockResolvedValueOnce({ occurredAt: previous })
  mockFind.mockResolvedValue([{ id: userId, name: 'Staff user' }])
  const response = await getDetail(request(`sign-ins/${attemptId}`), { params: Promise.resolve({ id: attemptId }) })
  const scopedOrganizations = [{ organizationId: null }, { organizationId: { $in: [organizationId] } }]
  expect(response.status).toBe(200)
  expect(mockFindOne).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), {
    tenantId, userId, result: 'success', occurredAt: { $lt: occurredAt }, $or: scopedOrganizations,
  }, expect.objectContaining({ orderBy: { occurredAt: 'desc', id: 'desc' } }), { tenantId })
  expect(mockFind).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
    tenantId, id: { $in: [userId] }, deletedAt: null, $or: scopedOrganizations,
  }, expect.anything(), { tenantId })
  expect(await response.json()).toMatchObject({ id: attemptId, userName: 'Staff user', previousSuccessAt: previous.toISOString() })
})

test('personal history is scoped to the authenticated user without exposing admin fields', async () => {
  mockFind.mockResolvedValue([{
    id: attemptId, userId, email: 'staff@example.test', occurredAt: new Date('2026-11-23T00:00:00Z'),
    result: 'success', deviceType: 'desktop', isNewDevice: false, mfaStatus: 'verified',
  }])
  const response = await getProfile(request('profile/sign-ins?days=7'))
  expect(response.status).toBe(200)
  expect(mockFind).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
    tenantId, userId, occurredAt: { $gte: expect.any(Date) },
  }, { limit: 10, orderBy: { occurredAt: 'desc', id: 'desc' } }, { tenantId })
  expect(await response.json()).toEqual({
    items: [{
      id: attemptId, occurredAt: '2026-11-23T00:00:00.000Z', result: 'success', deviceType: 'desktop',
      isNewDevice: false, mfaStatus: 'verified', reason: null, ipAddress: null, userAgent: null,
      browserName: null, browserMajor: null, osName: null,
    }],
  })
})

test('personal history rejects filters targeting other users and dates outside retention', async () => {
  expect(profileSignInQuerySchema.safeParse({ userId, ip: '203.0.113.9' }).success).toBe(false)
  const response = await getProfile(request('profile/sign-ins?days=91'))
  expect(response.status).toBe(400)
  expect(mockFind).not.toHaveBeenCalled()
})

test('all read paths are unavailable when the feature is disabled', async () => {
  process.env.OM_SECURITY_SIGN_IN_ACTIVITY = 'false'
  const responses = await Promise.all([
    getList(request('sign-ins')),
    getDetail(request(`sign-ins/${attemptId}`), { params: Promise.resolve({ id: attemptId }) }),
    getProfile(request('profile/sign-ins')),
  ])
  expect(responses.map((response) => response.status)).toEqual([404, 404, 404])
  expect(mockFind).not.toHaveBeenCalled()
  expect(mockFindOne).not.toHaveBeenCalled()
  expect(mockFindAndCount).not.toHaveBeenCalled()
})
