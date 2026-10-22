import type { EntityManager } from '@mikro-orm/core'
import { bullmqNextRunMatchesTiming, syncScheduleNextRunAt, type ScheduleTimingSnapshot } from '../nextRunSync'

const mockReadBullmqNextRun = jest.fn()

jest.mock('../bullmqNextRun', () => ({
  readBullmqNextRun: (...args: unknown[]) => mockReadBullmqNextRun(...args),
}))

const mockReportError = jest.fn()
let telemetryRuntime: { reportError: jest.Mock } | null = null

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => telemetryRuntime,
}))

const scheduleId = '11111111-1111-4111-8111-111111111111'
const nextRunAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'

const cronTiming: ScheduleTimingSnapshot = {
  scheduleId,
  tenantId,
  organizationId,
  scheduleType: 'cron',
  scheduleValue: '0 6 * * *',
  timezone: 'Europe/Warsaw',
}

const intervalTiming: ScheduleTimingSnapshot = {
  scheduleId,
  tenantId,
  organizationId,
  scheduleType: 'interval',
  scheduleValue: '15m',
  timezone: 'UTC',
}

function buildEm() {
  const execute = jest.fn(async () => ({ affectedRows: 1 }))
  const em = { getConnection: jest.fn(() => ({ execute })) } as unknown as EntityManager
  return { em, execute, resolveEm: jest.fn(() => em) }
}

describe('bullmqNextRunMatchesTiming', () => {
  it('matches a cron scheduler on pattern and timezone', () => {
    expect(bullmqNextRunMatchesTiming({ nextRunAt, pattern: '0 6 * * *', timezone: 'Europe/Warsaw' }, cronTiming)).toBe(true)
    expect(bullmqNextRunMatchesTiming({ nextRunAt, pattern: '0 7 * * *', timezone: 'Europe/Warsaw' }, cronTiming)).toBe(false)
    expect(bullmqNextRunMatchesTiming({ nextRunAt, pattern: '0 6 * * *', timezone: 'UTC' }, cronTiming)).toBe(false)
  })

  it('treats a missing timezone on either side as UTC', () => {
    expect(bullmqNextRunMatchesTiming(
      { nextRunAt, pattern: '0 6 * * *' },
      { ...cronTiming, timezone: 'UTC' },
    )).toBe(true)
    expect(bullmqNextRunMatchesTiming(
      { nextRunAt, pattern: '0 6 * * *', timezone: 'UTC' },
      { ...cronTiming, timezone: '' },
    )).toBe(true)
  })

  it('does not match a cron schedule against an every-based scheduler', () => {
    expect(bullmqNextRunMatchesTiming({ nextRunAt, every: 900000, timezone: 'Europe/Warsaw' }, cronTiming)).toBe(false)
  })

  it('matches an interval scheduler on its period', () => {
    expect(bullmqNextRunMatchesTiming({ nextRunAt, every: 900000, timezone: 'UTC' }, intervalTiming)).toBe(true)
    expect(bullmqNextRunMatchesTiming({ nextRunAt, every: 3600000, timezone: 'UTC' }, intervalTiming)).toBe(false)
    expect(bullmqNextRunMatchesTiming({ nextRunAt, pattern: '*/15 * * * *', timezone: 'UTC' }, intervalTiming)).toBe(false)
  })

  it('matches a sub-minute interval against both the clamped and the pre-clamp period', () => {
    const legacyTiming = { ...intervalTiming, scheduleValue: '30s' }
    expect(bullmqNextRunMatchesTiming({ nextRunAt, every: 60000 }, legacyTiming)).toBe(true)
    expect(bullmqNextRunMatchesTiming({ nextRunAt, every: 30000 }, legacyTiming)).toBe(true)
    expect(bullmqNextRunMatchesTiming({ nextRunAt, every: 45000 }, legacyTiming)).toBe(false)
  })

  it('does not match an interval value that cannot be parsed', () => {
    expect(bullmqNextRunMatchesTiming({ nextRunAt, every: 60000 }, { ...intervalTiming, scheduleValue: 'soon' })).toBe(false)
  })
})

describe('syncScheduleNextRunAt', () => {
  const originalStrategy = process.env.QUEUE_STRATEGY

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.QUEUE_STRATEGY = 'async'
    telemetryRuntime = { reportError: mockReportError }
    mockReportError.mockImplementation(() => undefined)
  })

  afterAll(() => {
    if (originalStrategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = originalStrategy
  })

  it('writes the BullMQ next slot guarded by the loaded timing, the database clock and the stored value', async () => {
    mockReadBullmqNextRun.mockResolvedValue({ nextRunAt, pattern: '0 6 * * *', timezone: 'Europe/Warsaw' })
    const { execute, resolveEm } = buildEm()

    await syncScheduleNextRunAt(resolveEm, cronTiming)

    expect(mockReadBullmqNextRun).toHaveBeenCalledWith(scheduleId)
    expect(execute).toHaveBeenCalledTimes(1)
    const [sql, params, method] = execute.mock.calls[0] as unknown as [string, unknown[], string]
    expect(sql.replace(/\s+/g, ' ')).toBe(
      'update scheduled_jobs set next_run_at = ? where id = ?'
      + ' and tenant_id is not distinct from ? and organization_id is not distinct from ?'
      + ' and deleted_at is null and is_enabled = true'
      + ' and schedule_type = ? and schedule_value = ? and timezone = ? and ? > now()'
      + ' and next_run_at is distinct from ?',
    )
    expect(params).toEqual([
      nextRunAt, scheduleId, tenantId, organizationId, 'cron', '0 6 * * *', 'Europe/Warsaw', nextRunAt, nextRunAt,
    ])
    expect(method).toBe('run')
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('binds a system-scoped schedule to null tenant and organization', async () => {
    mockReadBullmqNextRun.mockResolvedValue({ nextRunAt, pattern: '0 6 * * *', timezone: 'Europe/Warsaw' })
    const { execute, resolveEm } = buildEm()

    await syncScheduleNextRunAt(resolveEm, { ...cronTiming, tenantId: null, organizationId: null })

    const [, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
    expect(params.slice(1, 4)).toEqual([scheduleId, null, null])
  })

  it('does not set updated_at', async () => {
    mockReadBullmqNextRun.mockResolvedValue({ nextRunAt, every: 900000, timezone: 'UTC' })
    const { execute, resolveEm } = buildEm()

    await syncScheduleNextRunAt(resolveEm, intervalTiming)

    const [sql] = execute.mock.calls[0] as unknown as [string]
    expect(sql).not.toMatch(/updated_at/)
  })

  it.each([undefined, 'local'])('does nothing when QUEUE_STRATEGY is %s', async (strategy) => {
    if (strategy === undefined) delete process.env.QUEUE_STRATEGY
    else process.env.QUEUE_STRATEGY = strategy
    const { execute, resolveEm } = buildEm()

    await syncScheduleNextRunAt(resolveEm, cronTiming)

    expect(mockReadBullmqNextRun).not.toHaveBeenCalled()
    expect(resolveEm).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it('writes nothing when BullMQ has no next slot for the schedule', async () => {
    mockReadBullmqNextRun.mockResolvedValue(null)
    const { execute, resolveEm } = buildEm()

    await syncScheduleNextRunAt(resolveEm, cronTiming)

    expect(execute).not.toHaveBeenCalled()
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('writes nothing when the BullMQ scheduler was registered from a different timing', async () => {
    mockReadBullmqNextRun.mockResolvedValue({ nextRunAt, pattern: '0 0 1 1 *', timezone: 'Europe/Warsaw' })
    const { execute, resolveEm } = buildEm()

    await syncScheduleNextRunAt(resolveEm, cronTiming)

    expect(execute).not.toHaveBeenCalled()
    expect(mockReportError).not.toHaveBeenCalled()
  })

  it('swallows and reports a failed BullMQ read', async () => {
    const failure = new Error('redis unavailable')
    mockReadBullmqNextRun.mockRejectedValue(failure)
    const { execute, resolveEm } = buildEm()

    await expect(syncScheduleNextRunAt(resolveEm, cronTiming)).resolves.toBeUndefined()

    expect(execute).not.toHaveBeenCalled()
    expect(mockReportError).toHaveBeenCalledWith(failure, {
      module: 'scheduler',
      code: 'scheduler.next_run_sync_failed',
      attributes: { scheduleId },
    })
  })

  it('swallows and reports a failed database write', async () => {
    mockReadBullmqNextRun.mockResolvedValue({ nextRunAt, pattern: '0 6 * * *', timezone: 'Europe/Warsaw' })
    const { execute, resolveEm } = buildEm()
    const failure = new Error('connection terminated')
    execute.mockRejectedValue(failure)

    await expect(syncScheduleNextRunAt(resolveEm, cronTiming)).resolves.toBeUndefined()

    expect(mockReportError).toHaveBeenCalledWith(failure, expect.objectContaining({
      code: 'scheduler.next_run_sync_failed',
    }))
  })

  it('still resolves when the telemetry bridge itself throws', async () => {
    mockReadBullmqNextRun.mockRejectedValue(new Error('redis unavailable'))
    mockReportError.mockImplementation(() => {
      throw new Error('telemetry bridge broken')
    })
    const { resolveEm } = buildEm()

    await expect(syncScheduleNextRunAt(resolveEm, cronTiming)).resolves.toBeUndefined()
  })

  it('still resolves when no telemetry runtime is installed', async () => {
    telemetryRuntime = null
    mockReadBullmqNextRun.mockRejectedValue(new Error('redis unavailable'))
    const { resolveEm } = buildEm()

    await expect(syncScheduleNextRunAt(resolveEm, cronTiming)).resolves.toBeUndefined()
  })
})
