import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { ScheduleUpdateInput } from '../../data/validators.js'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string) => `translated:${key}`,
  }),
}))

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000
const THIRTY_MINUTES_MS = 30 * 60 * 1000

function loadUpdateCommand() {
  let update: CommandHandler<ScheduleUpdateInput, { ok: boolean }> | undefined
  jest.isolateModules(() => {
    require('../jobs')
    update = registerCommand.mock.calls.find(([command]) => command.id === 'scheduler.jobs.update')?.[0]
  })
  if (!update) throw new Error('[internal] scheduler.jobs.update was not registered')
  return update
}

type ScheduleRow = {
  id: string
  tenantId: string
  organizationId: string | null
  scopeType: string
  isEnabled: boolean
  scheduleType: 'cron' | 'interval'
  scheduleValue: string
  timezone: string
  nextRunAt: Date | null
  targetType: string
  targetCommand: string
  sourceType: string
}

function makeSchedule(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  return {
    id: 'job-1',
    tenantId: 'tenant-a',
    organizationId: null,
    scopeType: 'tenant',
    isEnabled: false,
    scheduleType: 'interval',
    scheduleValue: '15m',
    timezone: 'UTC',
    nextRunAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    targetType: 'command',
    targetCommand: 'example.todo.cleanup',
    sourceType: 'user',
    ...overrides,
  }
}

function makeEm(schedule: ScheduleRow) {
  return {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockResolvedValue(schedule),
    count: jest.fn().mockResolvedValue(0),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

function makeCtx(em: ReturnType<typeof makeEm>): CommandRuntimeContext {
  return {
    auth: { isSuperAdmin: false, tenantId: 'tenant-a', orgId: 'org-a' },
    container: { resolve: jest.fn(() => em) },
  } as unknown as CommandRuntimeContext
}

describe('scheduler.jobs.update nextRunAt on re-enable', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('recomputes a stale past nextRunAt from the stored interval when a disabled schedule is enabled', async () => {
    const update = loadUpdateCommand()
    const schedule = makeSchedule()
    const em = makeEm(schedule)

    const startedAt = Date.now()
    await expect(update.execute({ id: 'job-1', isEnabled: true }, makeCtx(em))).resolves.toEqual({ ok: true })
    const finishedAt = Date.now()

    expect(schedule.isEnabled).toBe(true)
    const nextRunAt = schedule.nextRunAt?.getTime() ?? 0
    expect(nextRunAt).toBeGreaterThanOrEqual(startedAt + FIFTEEN_MINUTES_MS)
    expect(nextRunAt).toBeLessThanOrEqual(finishedAt + FIFTEEN_MINUTES_MS)
  })

  it('recomputes nextRunAt from the stored cron expression when a disabled schedule is enabled', async () => {
    const update = loadUpdateCommand()
    const schedule = makeSchedule({ scheduleType: 'cron', scheduleValue: '0 0 * * *' })
    const em = makeEm(schedule)

    const startedAt = Date.now()
    await update.execute({ id: 'job-1', isEnabled: true }, makeCtx(em))

    const nextRunAt = schedule.nextRunAt as Date
    expect(nextRunAt.getTime()).toBeGreaterThan(startedAt)
    expect(nextRunAt.getUTCHours()).toBe(0)
    expect(nextRunAt.getUTCMinutes()).toBe(0)
  })

  it('uses the new schedule value when enabling and changing the interval in one update', async () => {
    const update = loadUpdateCommand()
    const schedule = makeSchedule()
    const em = makeEm(schedule)

    const startedAt = Date.now()
    await update.execute({ id: 'job-1', isEnabled: true, scheduleValue: '30m' }, makeCtx(em))
    const finishedAt = Date.now()

    const nextRunAt = schedule.nextRunAt?.getTime() ?? 0
    expect(nextRunAt).toBeGreaterThanOrEqual(startedAt + THIRTY_MINUTES_MS)
    expect(nextRunAt).toBeLessThanOrEqual(finishedAt + THIRTY_MINUTES_MS)
  })

  it('keeps nextRunAt when an already-enabled schedule is saved with isEnabled true', async () => {
    const update = loadUpdateCommand()
    const pendingRun = new Date(Date.now() + 5 * 60 * 1000)
    const schedule = makeSchedule({ isEnabled: true, nextRunAt: pendingRun })
    const em = makeEm(schedule)

    await update.execute({ id: 'job-1', isEnabled: true, name: 'Renamed' }, makeCtx(em))

    expect(schedule.nextRunAt).toBe(pendingRun)
  })

  it('keeps nextRunAt when a schedule is disabled', async () => {
    const update = loadUpdateCommand()
    const pendingRun = new Date(Date.now() + 5 * 60 * 1000)
    const schedule = makeSchedule({ isEnabled: true, nextRunAt: pendingRun })
    const em = makeEm(schedule)

    await update.execute({ id: 'job-1', isEnabled: false }, makeCtx(em))

    expect(schedule.isEnabled).toBe(false)
    expect(schedule.nextRunAt).toBe(pendingRun)
  })
})
