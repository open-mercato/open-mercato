import type { CommandHandler, CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import type { ScheduleCreateInput, ScheduleUpdateInput } from '../../data/validators.js'

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (key: string, _fallback?: string, params?: Record<string, unknown>) => (
      params?.max === undefined ? `translated:${key}` : `translated:${key}:max=${params.max}`
    ),
  }),
}))

type ScheduleRow = Record<string, unknown>

function loadCommands() {
  let create: CommandHandler<ScheduleCreateInput, { id: string }> | undefined
  let update: CommandHandler<ScheduleUpdateInput, { ok: boolean }> | undefined
  let del: CommandHandler<{ id: string }, { ok: boolean }> | undefined
  jest.isolateModules(() => {
    require('../jobs')
    create = registerCommand.mock.calls.find(([command]) => command.id === 'scheduler.jobs.create')?.[0]
    update = registerCommand.mock.calls.find(([command]) => command.id === 'scheduler.jobs.update')?.[0]
    del = registerCommand.mock.calls.find(([command]) => command.id === 'scheduler.jobs.delete')?.[0]
  })
  if (!create?.redo || !update?.undo || !del?.undo) throw new Error('[internal] Scheduler commands were not registered')
  return { createRedo: create.redo, updateUndo: update.undo, deleteUndo: del.undo }
}

function makeEm(row: ScheduleRow | null, activeCount: number) {
  return {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockResolvedValue(row),
    count: jest.fn().mockResolvedValue(activeCount),
    create: jest.fn((_entity: unknown, data: ScheduleRow) => data),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

function makeCtx(em: ReturnType<typeof makeEm>): CommandRuntimeContext {
  const dataEngine = { emitOrmEntityEvent: jest.fn(), markOrmEntityChange: jest.fn() }
  return {
    auth: { isSuperAdmin: false, tenantId: 'tenant-a', orgId: null },
    container: { resolve: jest.fn((name: string) => (name === 'dataEngine' ? dataEngine : em)) },
  } as unknown as CommandRuntimeContext
}

function snapshot(overrides: ScheduleRow = {}): ScheduleRow {
  return {
    id: 'job-1',
    name: 'Nightly report',
    description: null,
    scopeType: 'tenant',
    organizationId: null,
    tenantId: 'tenant-a',
    scheduleType: 'cron',
    scheduleValue: '0 0 * * *',
    timezone: 'UTC',
    targetType: 'command',
    targetQueue: null,
    targetCommand: 'scheduler.test.echo',
    targetPayload: null,
    requireFeature: null,
    isEnabled: true,
    sourceType: 'user',
    sourceModule: null,
    nextRunAt: null,
    lastRunAt: null,
    ...overrides,
  }
}

function logEntry(snapshots: { before?: ScheduleRow; after?: ScheduleRow }): CommandUndoLogEntry {
  return {
    commandPayload: { __redoInput: { id: 'job-1' }, undo: { ...snapshots } },
    snapshotBefore: snapshots.before,
    snapshotAfter: snapshots.after,
  } as unknown as CommandUndoLogEntry
}

const activeCountFilter = { tenantId: 'tenant-a', isEnabled: true, deletedAt: null }
const limitError = {
  status: 422,
  body: { error: 'translated:scheduler.error.active_schedule_limit:max=2' },
}

describe('scheduler.jobs undo/redo respect the tenant active-schedule cap', () => {
  const originalLimit = process.env.OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT

  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    process.env.OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT = '2'
  })

  afterEach(() => {
    if (originalLimit === undefined) delete process.env.OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT
    else process.env.OM_SCHEDULER_MAX_ACTIVE_SCHEDULES_PER_TENANT = originalLimit
  })

  it('rejects an update undo that re-enables a schedule when the tenant is at the cap', async () => {
    const { updateUndo } = loadCommands()
    const liveRow = snapshot({ name: 'Renamed', isEnabled: false, deletedAt: null })
    const em = makeEm(liveRow, 2)

    await expect(
      updateUndo({ logEntry: logEntry({ before: snapshot() }), ctx: makeCtx(em) }),
    ).rejects.toMatchObject(limitError)

    expect(em.count).toHaveBeenCalledWith(expect.any(Function), activeCountFilter)
    expect(em.flush).not.toHaveBeenCalled()
    expect(liveRow.isEnabled).toBe(false)
    expect(liveRow.name).toBe('Renamed')
  })

  it('allows an update undo that re-enables a schedule below the cap', async () => {
    const { updateUndo } = loadCommands()
    const liveRow = snapshot({ name: 'Renamed', isEnabled: false, deletedAt: null })
    const em = makeEm(liveRow, 1)

    await updateUndo({ logEntry: logEntry({ before: snapshot() }), ctx: makeCtx(em) })

    expect(em.count).toHaveBeenCalledWith(expect.any(Function), activeCountFilter)
    expect(em.flush).toHaveBeenCalled()
    expect(liveRow.isEnabled).toBe(true)
    expect(liveRow.name).toBe('Nightly report')
  })

  it('does not count active schedules when the update undo leaves the enabled state unchanged', async () => {
    const { updateUndo } = loadCommands()
    const liveRow = snapshot({ name: 'Renamed', deletedAt: null })
    const em = makeEm(liveRow, 2)

    await updateUndo({ logEntry: logEntry({ before: snapshot() }), ctx: makeCtx(em) })

    expect(em.count).not.toHaveBeenCalled()
    expect(liveRow.name).toBe('Nightly report')
  })

  it('does not count active schedules when the update undo disables a schedule', async () => {
    const { updateUndo } = loadCommands()
    const liveRow = snapshot({ deletedAt: null })
    const em = makeEm(liveRow, 2)

    await updateUndo({ logEntry: logEntry({ before: snapshot({ isEnabled: false }) }), ctx: makeCtx(em) })

    expect(em.count).not.toHaveBeenCalled()
    expect(liveRow.isEnabled).toBe(false)
  })

  it('rejects a delete undo that restores an enabled schedule when the tenant is at the cap', async () => {
    const { deleteUndo } = loadCommands()
    const deletedAt = new Date('2026-01-01T00:00:00.000Z')
    const liveRow = snapshot({ deletedAt })
    const em = makeEm(liveRow, 2)

    await expect(
      deleteUndo({ logEntry: logEntry({ before: snapshot() }), ctx: makeCtx(em) }),
    ).rejects.toMatchObject(limitError)

    expect(em.count).toHaveBeenCalledWith(expect.any(Function), activeCountFilter)
    expect(em.flush).not.toHaveBeenCalled()
    expect(liveRow.deletedAt).toBe(deletedAt)
  })

  it('rejects a delete undo that re-materializes an enabled schedule when the tenant is at the cap', async () => {
    const { deleteUndo } = loadCommands()
    const em = makeEm(null, 2)

    await expect(
      deleteUndo({ logEntry: logEntry({ before: snapshot() }), ctx: makeCtx(em) }),
    ).rejects.toMatchObject(limitError)

    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('restores a disabled schedule on delete undo without counting active schedules', async () => {
    const { deleteUndo } = loadCommands()
    const liveRow = snapshot({ isEnabled: false, deletedAt: new Date('2026-01-01T00:00:00.000Z') })
    const em = makeEm(liveRow, 2)

    await deleteUndo({ logEntry: logEntry({ before: snapshot({ isEnabled: false }) }), ctx: makeCtx(em) })

    expect(em.count).not.toHaveBeenCalled()
    expect(liveRow.deletedAt).toBeNull()
    expect(em.flush).toHaveBeenCalled()
  })

  it('rejects a create redo that re-creates an enabled schedule when the tenant is at the cap', async () => {
    const { createRedo } = loadCommands()
    const em = makeEm(null, 2)

    await expect(
      createRedo({ input: {} as ScheduleCreateInput, logEntry: logEntry({ after: snapshot() }), ctx: makeCtx(em) }),
    ).rejects.toMatchObject(limitError)

    expect(em.count).toHaveBeenCalledWith(expect.any(Function), activeCountFilter)
    expect(em.create).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('re-creates a disabled schedule on create redo without counting active schedules', async () => {
    const { createRedo } = loadCommands()
    const em = makeEm(null, 2)

    await createRedo({
      input: {} as ScheduleCreateInput,
      logEntry: logEntry({ after: snapshot({ isEnabled: false }) }),
      ctx: makeCtx(em),
    })

    expect(em.count).not.toHaveBeenCalled()
    expect(em.create).toHaveBeenCalled()
    expect(em.flush).toHaveBeenCalled()
  })
})
