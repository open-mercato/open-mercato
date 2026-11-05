/** @jest-environment node */

const WEBHOOK_ID = '123e4567-e89b-12d3-a456-426614174072'

const webhookRecord = {
  id: WEBHOOK_ID,
  isActive: false,
  consecutiveFailures: 2,
  autoDisableThreshold: 2,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  updatedAt: new Date('2026-06-01T10:00:00.000Z'),
}

const mockEm = {
  fork: jest.fn(() => mockEm),
  flush: jest.fn(async () => undefined),
}

const mockContainer = {
  resolve: (token: string) => {
    if (token === 'em') return mockEm
    if (token === 'commandOptimisticLockGuardService') throw new Error('not registered')
    return null
  },
}

jest.mock('../../../../events', () => ({
  emitWebhooksEvent: jest.fn(async () => undefined),
}))

jest.mock('../../../../lib/subscription-cache', () => ({
  invalidateWebhookSubscriptionCacheFor: jest.fn(async () => undefined),
}))

jest.mock('../../../helpers', () => ({
  json: (payload: unknown, init: ResponseInit = { status: 200 }) =>
    new Response(JSON.stringify(payload), {
      ...init,
      headers: { 'content-type': 'application/json' },
    }),
  resolveWebhookRequestScope: jest.fn(async () => ({
    container: mockContainer,
    em: mockEm,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  })),
  findScopedWebhook: jest.fn(async () => webhookRecord),
  canRevealWebhookCredentialHeaders: jest.fn(async () => true),
  translateWebhookCustomHeadersRejection: jest.fn(async () => 'rejected'),
  serializeWebhookDetail: (item: { id: string; isActive: boolean; consecutiveFailures: number }) => ({
    id: item.id,
    isActive: item.isActive,
    consecutiveFailures: item.consecutiveFailures,
  }),
}))

import { PUT } from '../route'

const context = { params: Promise.resolve({ id: WEBHOOK_ID }) }

function putRequest(body: unknown) {
  return new Request(`http://localhost/api/webhooks/${WEBHOOK_ID}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PUT /api/webhooks/:id re-activation', () => {
  beforeEach(() => {
    webhookRecord.isActive = false
    webhookRecord.consecutiveFailures = 2
  })

  it('resets consecutiveFailures when an auto-disabled webhook is turned back on', async () => {
    const res = await PUT(putRequest({ isActive: true }), context)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: WEBHOOK_ID, isActive: true, consecutiveFailures: 0 })
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('keeps consecutiveFailures on an update that does not re-activate the webhook', async () => {
    const res = await PUT(putRequest({ name: 'Renamed' }), context)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: WEBHOOK_ID, isActive: false, consecutiveFailures: 2 })
  })
})
