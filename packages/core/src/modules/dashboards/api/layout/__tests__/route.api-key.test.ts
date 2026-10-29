import type { AuthContext } from '@open-mercato/shared/lib/auth/server'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const actorId = 'api_key:44444444-4444-4444-8444-444444444444'
const itemId = '55555555-5555-4555-8555-555555555555'
const authMock = jest.fn<Promise<AuthContext>, []>()
const findUser = jest.fn()
const em = { fork: jest.fn(), findOne: jest.fn(), create: jest.fn(), persist: jest.fn(), flush: jest.fn() }
const rbac = { getEffectiveFeatures: jest.fn(), userHasAllFeatures: jest.fn() }
const guard = jest.fn()
const afterSuccess = jest.fn()
const allowedWidgets = jest.fn()
const container = { resolve: (name: string) => name === 'em' ? em : rbac }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: () => authMock() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => container }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: (...args: unknown[]) => findUser(...args) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))
jest.mock('@open-mercato/core/modules/dashboards/lib/widgets', () => ({
  loadAllWidgets: async () => [{ metadata: { id: 'visible', title: 'Visible' } }],
}))
jest.mock('@open-mercato/core/modules/dashboards/lib/access', () => ({
  resolveAllowedWidgetIds: (...args: unknown[]) => allowedWidgets(...args),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => guard(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => afterSuccess(...args),
}))

import { GET, PUT } from '../route'
import { PATCH } from '../[itemId]/route'

function request(method = 'GET'): Request {
  return new Request('http://localhost/api/dashboards/layout', {
    method,
    ...(method === 'GET' ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(method === 'PATCH' ? { size: 'lg' } : { items: [{ id: itemId, widgetId: 'visible', order: 0 }] }),
    }),
  })
}

const savedItems = [
  { id: itemId, widgetId: 'visible', order: 0, priority: 0 },
  { id: '66666666-6666-4666-8666-666666666666', widgetId: 'creator-only', order: 1, priority: 1 },
]

beforeEach(() => {
  jest.resetAllMocks()
  authMock.mockResolvedValue({ sub: actorId, userId, isApiKey: true, tenantId, orgId: organizationId, roles: ['restricted'] })
  findUser.mockResolvedValue({ id: userId, tenantId, organizationId, name: 'Ada', email: 'ada@example.com' })
  em.fork.mockReturnValue(em)
  em.findOne.mockResolvedValue({ layoutJson: savedItems.map((item) => ({ ...item })) })
  allowedWidgets.mockResolvedValue(['visible'])
  rbac.getEffectiveFeatures.mockResolvedValue(['dashboards.view'])
  rbac.userHasAllFeatures.mockResolvedValue(true)
  guard.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true })
})

it('uses the bound user for data and the key for capabilities without pruning the saved user layout', async () => {
  const layout = { layoutJson: savedItems.map((item) => ({ ...item })) }
  em.findOne.mockResolvedValue(layout)
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    context: { userId, tenantId, organizationId },
    canConfigure: false,
    layout: { items: [expect.objectContaining({ widgetId: 'visible' })] },
  })
  expect(em.findOne).toHaveBeenCalledWith(expect.anything(), { userId, tenantId, organizationId, deletedAt: null })
  expect(rbac.getEffectiveFeatures).toHaveBeenCalledWith(actorId, { tenantId, organizationId })
  expect(allowedWidgets).toHaveBeenCalledWith(em, expect.objectContaining({ userId, features: ['dashboards.view'] }), expect.anything())
  expect(layout.layoutJson).toEqual(savedItems)
  expect(em.flush).not.toHaveBeenCalled()
  expect(em.persist).not.toHaveBeenCalled()
})

it('does not seed a personal layout during an API-key read', async () => {
  em.findOne.mockResolvedValue(null)
  expect((await GET(request())).status).toBe(200)
  expect(em.create).not.toHaveBeenCalled()
  expect(em.persist).not.toHaveBeenCalled()
})

it.each(['GET', 'PUT', 'PATCH'])('rejects an unbound key before %s accesses personal data', async (method) => {
  authMock.mockResolvedValue({ sub: actorId, isApiKey: true, tenantId, orgId: organizationId })
  const response = method === 'GET' ? await GET(request()) : method === 'PUT' ? await PUT(request('PUT')) : await PATCH(request('PATCH'), { params: { itemId } })
  expect(response.status).toBe(403)
  expect(findUser).not.toHaveBeenCalled()
  expect(em.findOne).not.toHaveBeenCalled()
  expect(em.flush).not.toHaveBeenCalled()
})

it('rejects an out-of-scope binding before looking up a layout', async () => {
  findUser.mockResolvedValue(null)
  expect((await GET(request())).status).toBe(403)
  expect(findUser).toHaveBeenCalledWith(em, expect.anything(), {
    id: userId, tenantId, organizationId, deletedAt: null,
  }, undefined, { tenantId, organizationId })
  expect(em.findOne).not.toHaveBeenCalled()
})

it.each(['PUT', 'PATCH'])('does not inherit the creator permissions for %s', async (method) => {
  rbac.userHasAllFeatures.mockImplementation(async (subject: string) => subject !== actorId)
  const response = method === 'PUT' ? await PUT(request('PUT')) : await PATCH(request('PATCH'), { params: { itemId } })
  expect(response.status).toBe(403)
  expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(actorId, ['dashboards.configure'], { tenantId, organizationId })
  expect(guard).not.toHaveBeenCalled()
  expect(em.flush).not.toHaveBeenCalled()
})

it.each(['PUT', 'PATCH'])('attributes an authorized %s to the key while updating the bound user layout', async (method) => {
  const response = method === 'PUT' ? await PUT(request('PUT')) : await PATCH(request('PATCH'), { params: { itemId } })
  expect(response.status).toBe(200)
  expect(guard).toHaveBeenCalledWith(container, expect.objectContaining({ userId: actorId, tenantId, organizationId }))
  expect(afterSuccess).toHaveBeenCalledWith(container, expect.objectContaining({ userId: actorId }))
  expect(em.findOne).toHaveBeenCalledWith(expect.anything(), { userId, tenantId, organizationId, deletedAt: null })
  expect(em.flush).toHaveBeenCalledTimes(1)
  if (method === 'PUT') {
    expect(allowedWidgets).toHaveBeenCalledWith(em, expect.objectContaining({ userId }), expect.anything())
    expect(rbac.getEffectiveFeatures).toHaveBeenCalledWith(actorId, { tenantId, organizationId })
  }
})
