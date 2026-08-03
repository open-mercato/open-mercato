/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

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

// Optional enterprise command-guard service the async seam resolves from the
// request container. `null` = OSS-only build (container.resolve throws); a value
// = registered enterprise guard whose enforce() runs after the OSS floor passes.
let commandGuardService: { enforce: (input: unknown) => Promise<void> } | null = null

const mockContainer = {
  resolve: (token: string) => {
    if (token === 'commandOptimisticLockGuardService') {
      if (!commandGuardService) throw new Error('not registered')
      return commandGuardService
    }
    if (token === 'em') return mockEm
    return null
  },
}

jest.mock('../../../../events', () => ({
  emitWebhooksEvent: (...args: unknown[]) => mockEmitWebhooksEvent(...args),
}))

jest.mock('../../../helpers', () => ({
  json: (payload: unknown, init: ResponseInit = { status: 200 }) =>
    new Response(JSON.stringify(payload), {
      ...init,
      headers: { 'content-type': 'application/json' },
    }),
  resolveWebhookRequestScope: jest.fn(async () => ({ container: mockContainer, em: mockEm, tenantId: 'tenant-1', organizationId: 'org-1' })),
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
    commandGuardService = null
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

  // Phase 6b part B: the route awaits the async DI-aware seam
  // `enforceCommandOptimisticLockWithGuards(scope.container, ...)`.
  it('OM_OPTIMISTIC_LOCK=off disables the guard — a stale PUT is not blocked', async () => {
    process.env.OM_OPTIMISTIC_LOCK = 'off'
    const res = await PUT(request('PUT', STALE_VERSION, { name: 'X' }), context)
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('awaits the enterprise guard after the OSS floor passes; its 409 blocks the PUT before flush', async () => {
    commandGuardService = {
      enforce: jest.fn(async () => { throw new CrudHttpError(409, { code: 'record_lock_conflict' }) }),
    }
    const res = await PUT(request('PUT', CURRENT_VERSION, { name: 'X' }), context)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('record_lock_conflict')
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('degrades to OSS-only when the enterprise guard throws a non-conflict error (PUT still succeeds)', async () => {
    commandGuardService = { enforce: jest.fn(async () => { throw new Error('guard exploded') }) }
    const res = await PUT(request('PUT', CURRENT_VERSION, { name: 'X' }), context)
    expect(res.status).toBe(200)
    expect(mockEm.flush).toHaveBeenCalled()
  })
})
