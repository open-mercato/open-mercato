/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'
const SCHEDULE_ID = '123e4567-e89b-12d3-a456-426614174070'
const INTEGRATION_ID = 'demo-provider'

const mockGetAuthFromRequest = jest.fn()

const existingRow = {
  id: SCHEDULE_ID,
  integrationId: INTEGRATION_ID,
  entityType: 'products',
  direction: 'import' as const,
  scheduleType: 'cron' as const,
  scheduleValue: '0 * * * *',
  timezone: 'UTC',
  fullSync: false,
  isEnabled: true,
  scheduledJobId: SCHEDULE_ID,
  lastRunAt: null,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  createdAt: new Date('2026-05-01T10:00:00.000Z'),
  updatedAt: new Date(CURRENT_VERSION),
  deletedAt: null,
}

const mockEm = {
  create: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(async () => undefined),
}

const mockScheduler = { register: jest.fn(async () => undefined), unregister: jest.fn(async () => undefined) }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => existingRow),
  findAndCountWithDecryption: jest.fn(async () => [[], 0]),
}))

jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn((req: Request) => req.json()),
}))

const { createSyncScheduleService } = jest.requireActual('../../../lib/sync-schedule-service')

const scheduleService = createSyncScheduleService(mockEm, mockScheduler)

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'dataSyncScheduleService') return scheduleService
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

import { POST } from '../route'

function request(headerVersion: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request('http://localhost/api/data_sync/schedules', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      integrationId: INTEGRATION_ID,
      entityType: 'products',
      direction: 'import',
      scheduleType: 'cron',
      scheduleValue: '0 * * * *',
      timezone: 'UTC',
      fullSync: false,
      isEnabled: true,
    }),
  })
}

describe('data_sync schedule save optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })
  })

  it('returns 409 with the structured conflict body when the expected version is stale', async () => {
    const res = await POST(request(STALE_VERSION))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  it('succeeds when the expected version matches', async () => {
    const res = await POST(request(CURRENT_VERSION))
    expect(res.status).toBe(201)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  it('is a no-op (no 409) when the client sends no expected-version header', async () => {
    const res = await POST(request(null))
    expect(res.status).toBe(201)
    expect(mockEm.flush).toHaveBeenCalled()
  })
})
