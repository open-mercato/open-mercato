/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const WEBHOOK_ID = '123e4567-e89b-12d3-a456-426614174070'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const webhookRecord = {
  id: WEBHOOK_ID,
  name: 'Hook',
  description: null,
  url: 'https://example.com/hook',
  subscribedEvents: ['a.b.c'],
  httpMethod: 'POST',
  isActive: true,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  updatedAt: new Date(CURRENT_VERSION),
  deletedAt: null as Date | null,
}

const mockEm = {
  fork: jest.fn(() => mockEm),
  flush: jest.fn(async () => undefined),
}

const mockEmitWebhooksEvent = jest.fn(async () => undefined)

jest.mock('../../../../events', () => ({
  emitWebhooksEvent: (...args: unknown[]) => mockEmitWebhooksEvent(...args),
}))

jest.mock('../../../helpers', () => ({
  json: (payload: unknown, init: ResponseInit = { status: 200 }) =>
    new Response(JSON.stringify(payload), {
      ...init,
      headers: { 'content-type': 'application/json' },
    }),
  resolveWebhookRequestScope: jest.fn(async () => ({ em: mockEm, tenantId: 'tenant-1', organizationId: 'org-1' })),
  findScopedWebhook: jest.fn(async () => (webhookRecord.deletedAt ? null : webhookRecord)),
  serializeWebhookDetail: (item: { id: string; updatedAt: Date }) => ({
    id: item.id,
    updatedAt: item.updatedAt.toISOString(),
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (_key: string, fallback?: string) => fallback ?? '' })),
}))

import { PUT, DELETE } from '../route'

function request(method: string, headerVersion: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request(`http://localhost/api/webhooks/${WEBHOOK_ID}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const context = { params: Promise.resolve({ id: WEBHOOK_ID }) }

describe('webhook endpoint PUT/DELETE optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    webhookRecord.deletedAt = null
    delete process.env.OM_OPTIMISTIC_LOCK
  })

  it('PUT returns 409 with the structured conflict body when the expected version is stale', async () => {
    const res = await PUT(request('PUT', STALE_VERSION, { name: 'X' }), context)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('PUT succeeds when the expected version matches', async () => {
    const res = await PUT(request('PUT', CURRENT_VERSION, { name: 'X' }), context)
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('PUT is a no-op (no 409) when the client sends no expected-version header', async () => {
    const res = await PUT(request('PUT', null, { name: 'X' }), context)
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('DELETE returns 409 when the expected version is stale', async () => {
    const res = await DELETE(request('DELETE', STALE_VERSION), context)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(mockEm.flush).not.toHaveBeenCalled()
  })
})
