/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createInvalidScheduleValueError } from '@open-mercato/shared/lib/schedule/invalidScheduleValue'

const mockSaveSchedule = jest.fn()
const mockDeleteSchedule = jest.fn()
const mockLoggerError = jest.fn()
const mockReportError = jest.fn()
const mockTranslate = jest.fn((key: string) => `translated:${key}`)
const scheduleId = '3f8b1f1e-2c3d-4a5b-8c7d-9e0f1a2b3c4d'
const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }
const schedule = {
  id: scheduleId,
  integrationId: 'test-provider',
  entityType: 'customers.person',
  direction: 'import',
  scheduleType: 'cron',
  scheduleValue: '0 * * * *',
  timezone: 'UTC',
  fullSync: false,
  isEnabled: true,
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({ sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => token === 'dataSyncScheduleService' ? {
      saveSchedule: mockSaveSchedule,
      deleteSchedule: mockDeleteSchedule,
      getById: jest.fn(async () => schedule),
    } : null,
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: mockTranslate })),
}))

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => ({ child: jest.fn(() => ({ error: mockLoggerError })) })),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: jest.fn(() => ({ reportError: mockReportError })),
}))

import { POST } from '../route'
import { PUT, DELETE } from '../[id]/route'

function request(method: string) {
  return new Request(`http://localhost/api/data_sync/schedules/${scheduleId}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'DELETE' ? {} : { body: JSON.stringify(schedule) }),
  })
}

const writes = [
  { method: 'POST', operation: 'create', invoke: () => POST(request('POST')), translationKey: 'data_sync.dashboard.schedule.error' },
  { method: 'PUT', operation: 'update', invoke: () => PUT(request('PUT'), { params: { id: scheduleId } }), translationKey: 'data_sync.dashboard.schedule.error' },
  { method: 'DELETE', operation: 'delete', invoke: () => DELETE(request('DELETE'), { params: { id: scheduleId } }), translationKey: 'data_sync.dashboard.schedule.deleteError' },
]

describe.each(writes)('$method schedule write errors', ({ operation, invoke, translationKey }) => {
  beforeEach(() => jest.clearAllMocks())

  it.each([new Error('test.private_driver_failure'), 'test.non_error_failure'])('returns a translated generic 500 and records the original failure (%p)', async (failure) => {
    mockSaveSchedule.mockRejectedValue(failure)
    mockDeleteSchedule.mockRejectedValue(failure)

    const response = await invoke()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: `translated:${translationKey}` })
    expect(mockTranslate).toHaveBeenCalledWith(translationKey)
    expect(mockLoggerError).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ ...scope, operation, err: failure }))
    expect(mockReportError).toHaveBeenCalledWith(failure, {
      module: 'data_sync',
      code: 'data_sync.schedule_write_failed',
      attributes: expect.objectContaining({ ...scope, operation }),
    })
    if (operation !== 'create') {
      expect(mockLoggerError).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ scheduleId }))
    }
  })

  it('preserves deliberate CRUD errors without reporting them as infrastructure failures', async () => {
    const body = { error: 'test.conflict', code: 'test_conflict' }
    const failure = new CrudHttpError(409, body)
    mockSaveSchedule.mockRejectedValue(failure)
    mockDeleteSchedule.mockRejectedValue(failure)

    const response = await invoke()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(body)
    expect(mockLoggerError).not.toHaveBeenCalled()
    expect(mockReportError).not.toHaveBeenCalled()
    expect(mockTranslate).not.toHaveBeenCalled()
  })
})

describe.each(writes.filter(({ operation }) => operation !== 'delete'))('$method schedule validation', ({ invoke }) => {
  beforeEach(() => jest.clearAllMocks())

  it('keeps typed scheduler value errors at 422 with the structured field error', async () => {
    mockSaveSchedule.mockRejectedValue(createInvalidScheduleValueError('cron', 'not a cron', 'test.private_scheduler_detail'))

    const response = await invoke()
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.details.fieldErrors.scheduleValue).toHaveLength(1)
    expect(JSON.stringify(body)).not.toContain('test.private_scheduler_detail')
    expect(mockLoggerError).not.toHaveBeenCalled()
    expect(mockReportError).not.toHaveBeenCalled()
  })
})
