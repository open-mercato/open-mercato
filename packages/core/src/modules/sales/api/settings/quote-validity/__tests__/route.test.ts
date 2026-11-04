/** @jest-environment node */
import { GET, PUT } from '../route'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { loadSalesSettings } from '../../../../commands/settings'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const mockPermissions = new Set<string>()
const mockExecute = jest.fn()
const mockHasFeatures = jest.fn(async (_user: string, features: string[]) => features.every((feature) => mockPermissions.has(feature)))
const mockAfterSuccess = jest.fn()
const mockEm = {}

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({
  resolve: (key: string) => ({ em: mockEm, rbacService: { userHasAllFeatures: mockHasFeatures }, commandBus: { execute: mockExecute } })[key],
}) }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: async () => ({ selectedId: organizationId, filterIds: [organizationId], allowedIds: [organizationId] }) }))
jest.mock('../../../../commands/settings', () => ({ loadSalesSettings: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))

function request(method = 'GET', body: unknown = undefined) {
  return new Request('http://localhost/api/sales/settings/quote-validity', {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPermissions.clear()
  jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'user', tenantId, orgId: organizationId })
  jest.mocked(loadSalesSettings).mockResolvedValue(null)
  jest.mocked(runRouteMutationGuards).mockResolvedValue({ ok: true, runAfterSuccess: mockAfterSuccess })
  mockExecute.mockResolvedValue({ result: { defaultQuoteValidityDays: 30, updatedAt: '2026-11-04T12:00:00Z' } })
})

it.each(['sales.settings.manage', 'sales.quotes.manage'])('allows GET with %s and defaults an absent scoped row to 14', async (feature) => {
  mockPermissions.add(feature)
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ defaultQuoteValidityDays: 14, updatedAt: null })
  expect(loadSalesSettings).toHaveBeenCalledWith(mockEm, { tenantId, organizationId })
  expect(mockHasFeatures).toHaveBeenCalledWith('user', [feature], { tenantId, organizationId })
})
it('denies an unauthenticated read', async () => {
  jest.mocked(getAuthFromRequest).mockResolvedValue(null)
  expect((await GET(request())).status).toBe(401)
  expect(loadSalesSettings).not.toHaveBeenCalled()
})
it('denies GET without either feature and PUT with only quote management', async () => {
  expect((await GET(request())).status).toBe(403)
  mockPermissions.add('sales.quotes.manage')
  expect((await PUT(request('PUT', { defaultQuoteValidityDays: 30 }))).status).toBe(403)
  expect(mockExecute).not.toHaveBeenCalled()
})
it('uses server scope, validated guard changes, and the narrow settings command', async () => {
  mockPermissions.add('sales.settings.manage')
  jest.mocked(runRouteMutationGuards).mockResolvedValue({ ok: true, modifiedPayload: { defaultQuoteValidityDays: 45, tenantId: 'other' }, runAfterSuccess: mockAfterSuccess })
  const response = await PUT(request('PUT', { defaultQuoteValidityDays: 30, organizationId: 'other', tenantId: 'other' }))
  expect(response.status).toBe(200)
  expect(mockExecute).toHaveBeenCalledWith('sales.settings.quote_validity.save', {
    input: { tenantId, organizationId, defaultQuoteValidityDays: 45 }, ctx: expect.objectContaining({ selectedOrganizationId: organizationId }),
  })
  expect(mockAfterSuccess).toHaveBeenCalledTimes(1)
})
it('honors a blocked registry guard without executing the command', async () => {
  mockPermissions.add('sales.settings.manage')
  jest.mocked(runRouteMutationGuards).mockResolvedValue({ ok: false, errorStatus: 423, errorBody: { error: 'locked' }, response: Response.json({ error: 'locked' }, { status: 423 }) })
  expect((await PUT(request('PUT', { defaultQuoteValidityDays: 30 }))).status).toBe(423)
  expect(mockExecute).not.toHaveBeenCalled()
})
it.each([0, 366, 2.5, null])('rejects invalid duration %s before guards or writes', async (days) => {
  mockPermissions.add('sales.settings.manage')
  expect((await PUT(request('PUT', { defaultQuoteValidityDays: days }))).status).toBe(400)
  expect(runRouteMutationGuards).not.toHaveBeenCalled()
  expect(mockExecute).not.toHaveBeenCalled()
})
