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
import { XRAY_INGEST_QUEUE, ensureXrayIngestSchedule, xrayIngestScheduleId } from '../queue'

const SCOPE = { tenantId: '11111111-0000-4000-8000-000000000001', organizationId: '22222222-0000-4000-8000-000000000001' }

describe('ensureXrayIngestSchedule', () => {
  beforeEach(() => reportErrorMock.mockClear())

  it('upserts the per-organization tick with a stable id', async () => {
    const register = jest.fn(async () => undefined)
    const container = { resolve: () => ({ register }), hasRegistration: (name: string) => name === 'schedulerService' }
    expect(await ensureXrayIngestSchedule(container, SCOPE)).toBe(true)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      id: xrayIngestScheduleId(SCOPE.organizationId),
      scopeType: 'organization',
      tenantId: SCOPE.tenantId,
      organizationId: SCOPE.organizationId,
      targetQueue: XRAY_INGEST_QUEUE,
      targetPayload: { scope: SCOPE },
    }))
    expect(xrayIngestScheduleId(SCOPE.organizationId)).toBe(xrayIngestScheduleId(SCOPE.organizationId))
  })

  it('works with a resolve-only container (subscriber context) and is a no-op without the scheduler', async () => {
    const register = jest.fn(async () => undefined)
    expect(await ensureXrayIngestSchedule({ resolve: () => ({ register }) }, SCOPE)).toBe(true)
    expect(await ensureXrayIngestSchedule({ resolve: () => { throw new Error('not registered') } }, SCOPE)).toBe(false)
    expect(await ensureXrayIngestSchedule({ resolve: () => ({ register }), hasRegistration: () => false }, SCOPE)).toBe(false)
    expect(register).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).not.toHaveBeenCalled()
  })

  it('reports a failed registration without throwing', async () => {
    const failure = new Error('scheduler down')
    const container = { resolve: () => ({ register: async () => { throw failure } }) }
    expect(await ensureXrayIngestSchedule(container, SCOPE)).toBe(false)
    expect(reportErrorMock).toHaveBeenCalledWith(failure, expect.objectContaining({ code: 'insights.xray_schedule_failed' }))
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
