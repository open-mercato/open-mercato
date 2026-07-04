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

const rbac = { loadAcl: jest.fn() }

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'rbacService') return rbac
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const validateCrudMutationGuardMock = jest.fn()
const runCrudMutationGuardAfterSuccessMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: userId, tenantId, orgId: organizationId })),
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: (...args: unknown[]) => validateCrudMutationGuardMock(...args),
  runCrudMutationGuardAfterSuccess: (...args: unknown[]) => runCrudMutationGuardAfterSuccessMock(...args),
}))

import { PATCH } from '../route'

function buildRequest(): Request {
  return new Request(`http://localhost/api/dashboards/layout/${layoutItemId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: 'lg' }),
  })
}

describe('dashboards layout item route mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    em.flush.mockResolvedValue(undefined)
    rbac.loadAcl.mockResolvedValue({ isSuperAdmin: true, features: [] })
    em.findOne.mockResolvedValue({ layoutJson: [{ id: layoutItemId, widgetId: 'sales-summary', size: 'md' }] })
    validateCrudMutationGuardMock.mockResolvedValue({ ok: true, shouldRunAfterSuccess: true, metadata: { token: 'guard' } })
    runCrudMutationGuardAfterSuccessMock.mockResolvedValue(undefined)
  })

  it('short-circuits the write when the mutation guard blocks the request', async () => {
    validateCrudMutationGuardMock.mockResolvedValue({ ok: false, status: 409, body: { error: 'conflict' } })

    const response = await PATCH(buildRequest(), { params: { itemId: layoutItemId } })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'conflict' })
    expect(validateCrudMutationGuardMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dashboards.layout', resourceId: layoutItemId, operation: 'update' }),
    )
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).not.toHaveBeenCalled()
  })

  it('runs the after-success hook after a successful write', async () => {
    const response = await PATCH(buildRequest(), { params: { itemId: layoutItemId } })

    expect(response.status).toBe(200)
    expect(em.flush).toHaveBeenCalled()
    expect(runCrudMutationGuardAfterSuccessMock).toHaveBeenCalledWith(
      container,
      expect.objectContaining({ resourceKind: 'dashboards.layout', resourceId: layoutItemId, operation: 'update' }),
    )
  })

  it('updates object-shaped layouts without losing preferences', async () => {
    const layout = {
      layoutJson: {
        items: [{ id: layoutItemId, widgetId: 'sales-summary', order: 0, size: 'md' }],
        preferences: {
          dateRange: {
            preset: 'custom',
            from: '2024-01-01',
            to: '2024-01-31',
            compare: 'previous_year',
          },
        },
      },
    }
    em.findOne.mockResolvedValue(layout)

    const response = await PATCH(buildRequest(), { params: { itemId: layoutItemId } })

    expect(response.status).toBe(200)
    expect(layout.layoutJson).toEqual({
      items: [{ id: layoutItemId, widgetId: 'sales-summary', order: 0, priority: 0, size: 'lg', settings: undefined }],
      preferences: {
        dateRange: {
          preset: 'custom',
          from: '2024-01-01',
          to: '2024-01-31',
          compare: 'previous_year',
        },
      },
    })
  })

  it('preserves saved presets and activePresetId when patching an item', async () => {
    const presetId = '77777777-7777-4777-8777-777777777777'
    const layout = {
      layoutJson: {
        items: [{ id: layoutItemId, widgetId: 'sales-summary', order: 0, size: 'md' }],
        presets: [
          {
            id: presetId,
            name: 'Executive view',
            items: [{ id: layoutItemId, widgetId: 'sales-summary', order: 0, size: 'md' }],
          },
        ],
        activePresetId: presetId,
      },
    }
    em.findOne.mockResolvedValue(layout)

    const response = await PATCH(buildRequest(), { params: { itemId: layoutItemId } })

    expect(response.status).toBe(200)
    expect(layout.layoutJson).toEqual({
      items: [{ id: layoutItemId, widgetId: 'sales-summary', order: 0, priority: 0, size: 'lg', settings: undefined }],
      presets: [
        {
          id: presetId,
          name: 'Executive view',
          items: [{ id: layoutItemId, widgetId: 'sales-summary', order: 0, priority: 0, size: 'md', settings: undefined }],
        },
      ],
      activePresetId: presetId,
    })
  })
})
