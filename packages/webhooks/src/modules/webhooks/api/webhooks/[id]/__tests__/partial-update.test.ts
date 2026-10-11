/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const WEBHOOK_ID = '123e4567-e89b-12d3-a456-426614174072'

type WebhookFixture = ReturnType<typeof buildWebhook>

function buildWebhook() {
  return {
    id: WEBHOOK_ID,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    name: 'Partial update hook',
    description: 'Keeps its settings',
    url: 'https://example.com/hook',
    subscribedEvents: ['catalog.product.created'],
    httpMethod: 'PUT',
    isActive: true,
    deliveryStrategy: 'http',
    maxRetries: 3,
    timeoutMs: 5000,
    rateLimitPerMinute: 7,
    autoDisableThreshold: 5,
    consecutiveFailures: 0,
    customHeaders: { 'x-api-key': 'value' } as Record<string, string> | null,
    strategyConfig: { region: 'eu' } as Record<string, unknown> | null,
    integrationId: 'integration-1' as string | null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null as Date | null,
  }
}

let currentWebhook: WebhookFixture = buildWebhook()

type MockEm = { fork: jest.Mock<MockEm, []>; flush: jest.Mock<Promise<undefined>, []> }

const mockEm: MockEm = {
  fork: jest.fn((): MockEm => mockEm),
  flush: jest.fn(async () => undefined),
}

const mockEnforceLock = jest.fn(async (_container: unknown, _input: unknown) => undefined)
const mockInvalidateCache = jest.fn(async (..._args: unknown[]) => undefined)
const mockEmitWebhooksEvent = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({
  enforceCommandOptimisticLockWithGuards: (container: unknown, input: unknown) => mockEnforceLock(container, input),
}))

jest.mock('../../../../lib/subscription-cache', () => ({
  invalidateWebhookSubscriptionCacheFor: (...args: unknown[]) => mockInvalidateCache(...args),
}))

jest.mock('../../../../events', () => ({
  emitWebhooksEvent: (...args: unknown[]) => mockEmitWebhooksEvent(...args),
}))

jest.mock('../../../helpers', () => ({
  json: (payload: unknown, init: ResponseInit = { status: 200 }) =>
    new Response(JSON.stringify(payload), {
      ...init,
      headers: { 'content-type': 'application/json' },
    }),
  resolveWebhookRequestScope: jest.fn(async () => ({
    container: { resolve: () => null },
    em: mockEm,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    allowedOrganizationIds: null,
  })),
  findScopedWebhook: jest.fn(async () => currentWebhook),
  serializeWebhookDetail: (item: { id: string; isActive: boolean }) => ({ id: item.id, isActive: item.isActive }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? '' })),
}))

import { PUT } from '../route'

function putRequest(body: unknown) {
  return new Request(`http://localhost/api/webhooks/${WEBHOOK_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const context = () => ({ params: Promise.resolve({ id: WEBHOOK_ID }) })

describe('PUT /api/webhooks/:id — partial updates change only the sent fields', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    currentWebhook = buildWebhook()
  })

  it('deactivating and re-activating changes only isActive', async () => {
    const expected = buildWebhook()

    const deactivate = await PUT(putRequest({ isActive: false }), context())
    expect(deactivate.status).toBe(200)
    expect(currentWebhook).toEqual({ ...expected, isActive: false })

    const reactivate = await PUT(putRequest({ isActive: true }), context())
    expect(reactivate.status).toBe(200)
    expect(currentWebhook).toEqual(expected)
    expect(mockEm.flush).toHaveBeenCalledTimes(2)
  })

  it('a single-field update {maxRetries:4} changes only maxRetries', async () => {
    const response = await PUT(putRequest({ maxRetries: 4 }), context())
    expect(response.status).toBe(200)
    expect(currentWebhook).toEqual({ ...buildWebhook(), maxRetries: 4 })
  })

  it('applies explicitly sent defaulted fields', async () => {
    const response = await PUT(putRequest({ httpMethod: 'PATCH', timeoutMs: 20000 }), context())
    expect(response.status).toBe(200)
    expect(currentWebhook).toEqual({ ...buildWebhook(), httpMethod: 'PATCH', timeoutMs: 20000 })
  })

  it('rejects an invalid body with 400 and mutates nothing', async () => {
    const response = await PUT(putRequest({ maxRetries: 31, isActive: false }), context())
    expect(response.status).toBe(400)
    expect(currentWebhook).toEqual(buildWebhook())
    expect(mockEm.flush).not.toHaveBeenCalled()
    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
  })

  it('returns 409 and mutates nothing when the optimistic-lock guard rejects the request', async () => {
    mockEnforceLock.mockImplementationOnce(async () => {
      throw new CrudHttpError(409, { code: 'optimistic_lock_conflict' })
    })
    const response = await PUT(putRequest({ isActive: false }), context())
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(currentWebhook).toEqual(buildWebhook())
    expect(mockEm.flush).not.toHaveBeenCalled()
    expect(mockInvalidateCache).not.toHaveBeenCalled()
    expect(mockEmitWebhooksEvent).not.toHaveBeenCalled()
  })
})
