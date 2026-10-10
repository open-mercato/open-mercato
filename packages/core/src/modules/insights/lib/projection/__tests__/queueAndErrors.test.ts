const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silent = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), trace: jest.fn(), child: () => silent }
  return { ...actual, createLogger: () => silent }
})

import { describeXrayError, isStatementTimeoutError } from '../errors'
import {
  XRAY_FANOUT_KIND,
  XRAY_INGEST_INTERVAL,
  XRAY_INGEST_QUEUE,
  XRAY_INGEST_SCHEDULE_ID,
  ensureXrayIngestSchedule,
  isLegacyXrayIngestSchedule,
} from '../queue'

const ORG_A = '22222222-0000-4000-8000-000000000001'
const ORG_B = '22222222-0000-4000-8000-000000000002'
const TENANT_A = '11111111-0000-4000-8000-000000000001'

type ScheduleRow = { id: string; scopeType: string; targetQueue: string | null; sourceType: string; sourceModule: string | null; tenantId?: string | null; organizationId?: string | null }

function legacyRow(organizationId: string): ScheduleRow {
  return { id: `legacy-${organizationId}`, scopeType: 'organization', targetQueue: XRAY_INGEST_QUEUE, sourceType: 'module', sourceModule: 'insights', tenantId: TENANT_A, organizationId }
}

function schedulerService(rows: ScheduleRow[], options: { exists?: boolean } = {}) {
  const table = [...rows]
  return {
    table,
    register: jest.fn(async (registration: ScheduleRow) => { table.push({ ...registration }) }),
    exists: jest.fn(async (id: string) => options.exists ?? table.some((row) => row.id === id)),
    findByModule: jest.fn(async (moduleId: string, limit = 100) => table.filter((row) => row.sourceModule === moduleId).slice(0, limit)),
    unregister: jest.fn(async (id: string) => {
      const index = table.findIndex((row) => row.id === id)
      if (index >= 0) table.splice(index, 1)
    }),
  }
}

function containerFor(service: unknown) {
  return { resolve: () => service, hasRegistration: (name: string) => name === 'schedulerService' }
}

describe('ensureXrayIngestSchedule', () => {
  beforeEach(() => reportErrorMock.mockClear())

  it('registers one system-scoped fan-out tick with a stable id, outside every tenant quota', async () => {
    const service = schedulerService([])
    expect(await ensureXrayIngestSchedule(containerFor(service))).toBe(true)
    expect(service.register).toHaveBeenCalledTimes(1)
    const registration = service.register.mock.calls[0][0] as Record<string, unknown>
    expect(registration).toEqual(expect.objectContaining({
      id: XRAY_INGEST_SCHEDULE_ID,
      scopeType: 'system',
      scheduleType: 'interval',
      scheduleValue: XRAY_INGEST_INTERVAL,
      targetType: 'queue',
      targetQueue: XRAY_INGEST_QUEUE,
      targetPayload: { kind: XRAY_FANOUT_KIND },
      sourceType: 'module',
      sourceModule: 'insights',
    }))
    expect(registration).not.toHaveProperty('tenantId')
    expect(registration).not.toHaveProperty('organizationId')
    expect(registration).not.toHaveProperty('isEnabled')
    expect(await ensureXrayIngestSchedule(containerFor(service))).toBe(true)
    expect(service.register).toHaveBeenCalledTimes(1)
  })

  it('leaves an existing (possibly admin-disabled) system schedule untouched', async () => {
    const service = schedulerService([], { exists: true })
    expect(await ensureXrayIngestSchedule(containerFor(service))).toBe(true)
    expect(service.exists).toHaveBeenCalledWith(XRAY_INGEST_SCHEDULE_ID)
    expect(service.register).not.toHaveBeenCalled()
  })

  it('removes the per-organization schedules of the previous design through the scheduler service', async () => {
    const other: ScheduleRow = { id: 'other', scopeType: 'organization', targetQueue: 'insights-other', sourceType: 'module', sourceModule: 'insights' }
    const userMade: ScheduleRow = { ...legacyRow(ORG_B), id: 'user-made', sourceType: 'user' }
    const service = schedulerService([legacyRow(ORG_A), legacyRow(ORG_B), other, userMade])
    expect(await ensureXrayIngestSchedule(containerFor(service))).toBe(true)
    expect(service.unregister.mock.calls.map(([id]) => id)).toEqual([`legacy-${ORG_A}`, `legacy-${ORG_B}`])
    expect(service.table.map((row) => row.id)).toEqual(['other', 'user-made', XRAY_INGEST_SCHEDULE_ID])
  })

  it('keeps the per-organization schedules while the system schedule could not be registered', async () => {
    const service = schedulerService([legacyRow(ORG_A)])
    const failure = new Error('scheduler down')
    service.register.mockRejectedValueOnce(failure)
    expect(await ensureXrayIngestSchedule(containerFor(service))).toBe(false)
    expect(service.unregister).not.toHaveBeenCalled()
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'insights.xray_schedule_failed' }))
  })

  it('works with a resolve-only container (subscriber context) and is a no-op without the scheduler', async () => {
    const register = jest.fn(async () => undefined)
    expect(await ensureXrayIngestSchedule({ resolve: () => ({ register }) })).toBe(true)
    expect(await ensureXrayIngestSchedule({ resolve: () => { throw new Error('not registered') } })).toBe(false)
    expect(await ensureXrayIngestSchedule({ resolve: () => ({ register }), hasRegistration: () => false })).toBe(false)
    expect(register).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('recognizes only module-owned per-organization ingest rows as legacy', () => {
    expect(isLegacyXrayIngestSchedule(legacyRow(ORG_A))).toBe(true)
    expect(isLegacyXrayIngestSchedule({ ...legacyRow(ORG_A), id: XRAY_INGEST_SCHEDULE_ID })).toBe(false)
    expect(isLegacyXrayIngestSchedule({ ...legacyRow(ORG_A), scopeType: 'system' })).toBe(false)
    expect(isLegacyXrayIngestSchedule({ ...legacyRow(ORG_A), sourceType: 'user' })).toBe(false)
    expect(isLegacyXrayIngestSchedule({ ...legacyRow(ORG_A), sourceModule: 'sales' })).toBe(false)
  })
})

describe('X-Ray error descriptions', () => {
  it('keeps platform [internal] messages and reduces anything else to its name and SQLSTATE', () => {
    expect(describeXrayError(new Error('[internal] The X-Ray projection lease was lost to another worker'))).toBe('[internal] The X-Ray projection lease was lost to another worker')
    const databaseError = Object.assign(new Error('duplicate key value violates unique constraint (secret@example.com)'), { name: 'DatabaseError', code: '23505' })
    expect(describeXrayError(databaseError)).toBe('DatabaseError (SQLSTATE 23505)')
    expect(describeXrayError(new TypeError('value secret is invalid'))).toBe('TypeError')
    expect(describeXrayError('a string with secret')).toBe('Error')
    expect(describeXrayError(Object.assign(new Error('wrapped'), { cause: { code: '57014' } }))).toBe('Error (SQLSTATE 57014)')
  })

  it('recognizes a statement timeout directly or through its cause', () => {
    expect(isStatementTimeoutError(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }))).toBe(true)
    expect(isStatementTimeoutError(Object.assign(new Error('wrapped'), { cause: Object.assign(new Error('inner'), { code: '57014' }) }))).toBe(true)
    expect(isStatementTimeoutError(Object.assign(new Error('deadlock'), { code: '40P01' }))).toBe(false)
    expect(isStatementTimeoutError(null)).toBe(false)
  })
})
