export {}

// Regression coverage for issue #2504: scheduler.jobs undo handlers were silent
// no-ops because they read `logEntry.payload` (always undefined) instead of the
// persisted `commandPayload`. These tests construct the logEntry exactly as the
// command bus persists it (redo-wrapped `commandPayload`, no top-level `payload`)
// and assert undo actually restores state.

const registerCommand = jest.fn()

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

function loadCommands() {
  let create: any
  let update: any
  let del: any
  jest.isolateModules(() => {
    require('../jobs')
    create = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'scheduler.jobs.create')?.[0]
    update = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'scheduler.jobs.update')?.[0]
    del = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'scheduler.jobs.delete')?.[0]
  })
  return { create, update, del }
}

function makeEm(schedule: Record<string, unknown> | null) {
  const removeFlush = jest.fn().mockResolvedValue(undefined)
  const created: Record<string, unknown>[] = []
  const em: any = {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockResolvedValue(schedule),
    persist: jest.fn(),
    remove: jest.fn().mockReturnValue({ flush: removeFlush }),
    flush: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => {
      created.push(data)
      return data
    }),
    __created: created,
    __removeFlush: removeFlush,
  }
  return em
}

function makeCtx(em: any) {
  return {
    auth: { isSuperAdmin: true, tenantId: null },
    container: { resolve: jest.fn(() => em) },
  } as any
}

// Mirrors command-bus.persistLog: metadata.payload becomes the redo-wrapped
// `commandPayload`; there is no top-level `payload` on the stored row.
function persistedLogEntry(snapshots: { before?: unknown; after?: unknown }) {
  return {
    commandPayload: { __redoInput: { id: 'job-1' }, undo: { ...snapshots } },
    snapshotBefore: snapshots.before,
    snapshotAfter: snapshots.after,
  }
}

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    name: 'Nightly report',
    description: 'original description',
    scopeType: 'tenant',
    organizationId: null,
    tenantId: 'tenant-a',
    scheduleType: 'cron',
    scheduleValue: '0 0 * * *',
    timezone: 'UTC',
    targetType: 'queue',
    targetQueue: 'default',
    targetCommand: null,
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

describe('scheduler.jobs undo restores state (issue #2504)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('update undo restores the prior field values from commandPayload', async () => {
    const { update } = loadCommands()
    expect(update).toBeDefined()

    const before = baseSnapshot({ name: 'Nightly report' })
    const after = baseSnapshot({ name: 'Nightly report RENAMED' })
    // The live row currently holds the post-update ("after") state.
    const liveRow: Record<string, unknown> = { ...after }
    const em = makeEm(liveRow)

    await update.undo({ logEntry: persistedLogEntry({ before, after }), ctx: makeCtx(em) })

    expect(em.flush).toHaveBeenCalled()
    expect(liveRow.name).toBe('Nightly report')
  })

  it('update undo keeps the live run state when the schedule definition is unchanged', async () => {
    const { update } = loadCommands()
    const before = baseSnapshot({ nextRunAt: '2020-01-02T00:00:00.000Z', lastRunAt: '2020-01-01T00:00:00.000Z' })
    const liveLastRunAt = new Date('2026-06-04T00:00:00.000Z')
    const liveNextRunAt = new Date('2026-06-05T00:00:00.000Z')
    const liveRow: Record<string, unknown> = {
      ...baseSnapshot({ name: 'Nightly report RENAMED' }),
      lastRunAt: liveLastRunAt,
      nextRunAt: liveNextRunAt,
    }
    const em = makeEm(liveRow)

    await update.undo({ logEntry: persistedLogEntry({ before }), ctx: makeCtx(em) })

    expect(liveRow.name).toBe('Nightly report')
    expect(liveRow.lastRunAt).toBe(liveLastRunAt)
    expect(liveRow.nextRunAt).toBe(liveNextRunAt)
  })

  it('update undo recomputes nextRunAt from the restored schedule definition', async () => {
    const { update } = loadCommands()
    const before = baseSnapshot({
      scheduleValue: '0 0 * * *',
      nextRunAt: '2020-01-02T00:00:00.000Z',
      lastRunAt: '2020-01-01T00:00:00.000Z',
    })
    const liveLastRunAt = new Date('2026-06-04T12:00:00.000Z')
    const liveRow: Record<string, unknown> = {
      ...baseSnapshot({ scheduleValue: '0 12 * * *' }),
      lastRunAt: liveLastRunAt,
      nextRunAt: new Date('2026-06-05T12:00:00.000Z'),
    }
    const em = makeEm(liveRow)
    const undoStartedAt = Date.now()

    await update.undo({ logEntry: persistedLogEntry({ before }), ctx: makeCtx(em) })

    expect(liveRow.scheduleValue).toBe('0 0 * * *')
    expect(liveRow.lastRunAt).toBe(liveLastRunAt)
    expect(liveRow.nextRunAt).toBeInstanceOf(Date)
    const nextRunAt = liveRow.nextRunAt as Date
    expect(nextRunAt.getTime()).toBeGreaterThan(undoStartedAt)
    expect(nextRunAt.getUTCHours()).toBe(0)
    expect(nextRunAt.getUTCMinutes()).toBe(0)
  })

  it('update undo is a no-op when no snapshot is recoverable', async () => {
    const { update } = loadCommands()
    const em = makeEm({ id: 'job-1', name: 'whatever' })
    // No commandPayload and no snapshots -> nothing to restore.
    await update.undo({ logEntry: { commandPayload: null }, ctx: makeCtx(em) })
    expect(em.findOne).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('create undo removes the created row using the after snapshot', async () => {
    const { create } = loadCommands()
    const after = baseSnapshot()
    const liveRow = { ...after }
    const em = makeEm(liveRow)

    await create.undo({ logEntry: persistedLogEntry({ after }), ctx: makeCtx(em) })

    expect(em.remove).toHaveBeenCalledWith(liveRow)
    expect(em.__removeFlush).toHaveBeenCalled()
  })

  it('delete undo restores a soft-deleted row by clearing deletedAt', async () => {
    const { del } = loadCommands()
    const before = baseSnapshot()
    const liveRow: Record<string, unknown> = { ...before, deletedAt: new Date() }
    const em = makeEm(liveRow)

    await del.undo({ logEntry: persistedLogEntry({ before }), ctx: makeCtx(em) })

    expect(liveRow.deletedAt).toBeNull()
    expect(em.flush).toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
  })

  it('delete undo re-materializes a hard-removed row from the snapshot', async () => {
    const { del } = loadCommands()
    const before = baseSnapshot({ name: 'Hard removed job', nextRunAt: '2026-06-05T00:00:00.000Z' })
    // findOne returns null -> the row no longer exists and must be re-created.
    const em = makeEm(null)

    await del.undo({ logEntry: persistedLogEntry({ before }), ctx: makeCtx(em) })

    expect(em.create).toHaveBeenCalled()
    expect(em.__created[0]).toMatchObject({ id: 'job-1', name: 'Hard removed job', deletedAt: null })
    // Re-materialization also coerces JSON date strings to Date instances.
    expect(em.__created[0].nextRunAt).toBeInstanceOf(Date)
    expect(em.flush).toHaveBeenCalled()
  })
})
