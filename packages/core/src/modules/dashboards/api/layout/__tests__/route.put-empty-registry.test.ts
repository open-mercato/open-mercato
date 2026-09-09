/**
 * Regression tests for #5041 on the write path. `PUT` filters the submitted layout
 * through an allowlist derived from the widget registry and persists the result
 * unconditionally, so a boot-race empty registry made it save `[]` while answering
 * `{ ok: true }` — the same data loss as the `GET` trim, but worse, because the whole
 * layout is replaced and the client is told the save succeeded. The handler now
 * refuses the write while the registry is empty.
 */
const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const layoutItemId = '66666666-6666-4666-8666-666666666666'

const em = {
  fork: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
}

const rbac = {
  loadAcl: jest.fn(),
  getEffectiveFeatures: jest.fn(),
  userHasAllFeatures: jest.fn(),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbac
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const loadAllWidgetsMock = jest.fn()
const resolveAllowedWidgetIdsMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: userId, tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => null),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: false, metadata: null })),
  runCrudMutationGuardAfterSuccess: jest.fn(async () => undefined),
}))

jest.mock('@open-mercato/core/modules/dashboards/lib/widgets', () => ({
  loadAllWidgets: (...args: unknown[]) => loadAllWidgetsMock(...args),
}))

jest.mock('@open-mercato/core/modules/dashboards/lib/access', () => ({
  resolveAllowedWidgetIds: (...args: unknown[]) => resolveAllowedWidgetIdsMock(...args),
}))

import { PUT } from '../route'

const savedItems = [
  { id: layoutItemId, widgetId: 'sales-summary', order: 0, priority: 0, size: 'md' },
]

function buildRequest(items: unknown[]): Request {
  return new Request('http://localhost/api/dashboards/layout', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  })
}

describe('#5041: dashboards layout PUT with an empty widget registry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.flush.mockResolvedValue(undefined)
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    rbac.userHasAllFeatures.mockResolvedValue(true)
    rbac.getEffectiveFeatures.mockResolvedValue(['dashboards.view', 'dashboards.configure'])
    resolveAllowedWidgetIdsMock.mockResolvedValue([])
  })

  it('refuses the write and leaves the stored layout untouched', async () => {
    const storedLayout = { id: 'layout-1', layoutJson: [...savedItems] }
    em.findOne.mockResolvedValue(storedLayout)
    loadAllWidgetsMock.mockResolvedValue([])

    const response = await PUT(buildRequest(savedItems))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.ok).toBeUndefined()
    expect(storedLayout.layoutJson).toEqual(savedItems)
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('does not create a layout row for a first-time user', async () => {
    em.findOne.mockResolvedValue(null)
    loadAllWidgetsMock.mockResolvedValue([])

    const response = await PUT(buildRequest(savedItems))

    expect(response.status).toBe(503)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('still saves normally when the registry is healthy', async () => {
    const storedLayout = { id: 'layout-1', layoutJson: [] as unknown[] }
    em.findOne.mockResolvedValue(storedLayout)
    loadAllWidgetsMock.mockResolvedValue([
      { key: 'core:sales:widget', moduleId: 'sales', metadata: { id: 'sales-summary', title: 'Sales' } },
    ])
    resolveAllowedWidgetIdsMock.mockResolvedValue(['sales-summary'])

    const response = await PUT(buildRequest(savedItems))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(storedLayout.layoutJson.map((item: any) => item.widgetId)).toEqual(['sales-summary'])
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('still drops a submitted widget the user is not allowed to place', async () => {
    const storedLayout = { id: 'layout-1', layoutJson: [...savedItems] }
    em.findOne.mockResolvedValue(storedLayout)
    loadAllWidgetsMock.mockResolvedValue([
      { key: 'core:sales:widget', moduleId: 'sales', metadata: { id: 'sales-summary', title: 'Sales' } },
    ])
    resolveAllowedWidgetIdsMock.mockResolvedValue([])

    const response = await PUT(buildRequest(savedItems))

    expect(response.status).toBe(200)
    expect(storedLayout.layoutJson).toEqual([])
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
