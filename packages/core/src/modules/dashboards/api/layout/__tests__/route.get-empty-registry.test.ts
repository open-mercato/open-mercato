/**
 * Regression tests for #5041 — the layout GET is a read endpoint and must not
 * write a layout derived from a widget registry that came back empty. Before the
 * fix, a boot-race empty registry made GET intersect every saved layout with an
 * empty allowlist and persist the result, so the data loss survived the restart
 * that repaired the registry.
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

jest.mock('@open-mercato/core/modules/dashboards/lib/widgets', () => ({
  loadAllWidgets: (...args: unknown[]) => loadAllWidgetsMock(...args),
}))

jest.mock('@open-mercato/core/modules/dashboards/lib/access', () => ({
  resolveAllowedWidgetIds: (...args: unknown[]) => resolveAllowedWidgetIdsMock(...args),
}))

import { GET } from '../route'

const savedItems = [
  { id: layoutItemId, widgetId: 'sales-summary', order: 0, priority: 0, size: 'md' },
]

function buildRequest(): Request {
  return new Request('http://localhost/api/dashboards/layout', { method: 'GET' })
}

describe('#5041: dashboards layout GET with an empty widget registry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
    em.flush.mockResolvedValue(undefined)
    em.create.mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({ id: 'rec', ...payload }))
    rbac.getEffectiveFeatures.mockResolvedValue(['dashboards.view'])
    resolveAllowedWidgetIdsMock.mockResolvedValue([])
  })

  it('serves the saved layout untouched and persists nothing', async () => {
    const storedLayout = { id: 'layout-1', layoutJson: [...savedItems] }
    em.findOne.mockResolvedValue(storedLayout)
    loadAllWidgetsMock.mockResolvedValue([])

    const response = await GET(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.layout.items).toHaveLength(1)
    expect(body.layout.items[0].widgetId).toBe('sales-summary')
    expect(storedLayout.layoutJson).toEqual(savedItems)
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
  })

  it('does not seed a layout row for a first-time user', async () => {
    em.findOne.mockResolvedValue(null)
    loadAllWidgetsMock.mockResolvedValue([])

    const response = await GET(buildRequest())

    expect(response.status).toBe(200)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('still prunes widgets the user lost access to when the registry is healthy', async () => {
    const storedLayout = {
      id: 'layout-1',
      layoutJson: [
        ...savedItems,
        { id: '77777777-7777-4777-8777-777777777777', widgetId: 'revoked-widget', order: 1, priority: 1, size: 'md' },
      ],
    }
    em.findOne.mockResolvedValue(storedLayout)
    loadAllWidgetsMock.mockResolvedValue([
      { key: 'core:sales:widget', moduleId: 'sales', metadata: { id: 'sales-summary', title: 'Sales' } },
    ])
    resolveAllowedWidgetIdsMock.mockResolvedValue(['sales-summary'])

    const response = await GET(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.layout.items.map((item: { widgetId: string }) => item.widgetId)).toEqual(['sales-summary'])
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  // The guard keys off the registry, not off the allowlist. A user whose allowlist is
  // legitimately empty on a healthy registry — every widget revoked, or a tenant with no
  // grants yet — must still be pruned exactly as before, or a future refactor could
  // conflate "no widgets registered" with "no widgets allowed" and disable trimming.
  it('still trims to an empty layout when the registry is healthy but the allowlist is empty', async () => {
    const storedLayout = { id: 'layout-1', layoutJson: [...savedItems] }
    em.findOne.mockResolvedValue(storedLayout)
    loadAllWidgetsMock.mockResolvedValue([
      { key: 'core:sales:widget', moduleId: 'sales', metadata: { id: 'sales-summary', title: 'Sales' } },
    ])
    resolveAllowedWidgetIdsMock.mockResolvedValue([])

    const response = await GET(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.layout.items).toEqual([])
    expect(storedLayout.layoutJson).toEqual([])
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('seeds defaults for a first-time user when the registry is healthy', async () => {
    em.findOne.mockResolvedValue(null)
    loadAllWidgetsMock.mockResolvedValue([
      { key: 'core:sales:widget', moduleId: 'sales', metadata: { id: 'sales-summary', title: 'Sales', defaultEnabled: true } },
    ])
    resolveAllowedWidgetIdsMock.mockResolvedValue(['sales-summary'])

    const response = await GET(buildRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.layout.items.map((item: { widgetId: string }) => item.widgetId)).toEqual(['sales-summary'])
    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })
})
