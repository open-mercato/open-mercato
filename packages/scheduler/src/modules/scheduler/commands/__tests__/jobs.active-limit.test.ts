export {}

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
  jest.isolateModules(() => {
    require('../jobs')
    create = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'scheduler.jobs.create')?.[0]
    update = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'scheduler.jobs.update')?.[0]
  })
  return { create, update }
}

function makeEm(schedule: Record<string, unknown> | null) {
  return {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockResolvedValue(schedule),
    count: jest.fn(),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'new-job', ...data })),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
  }
}

function makeCtx(em: any) {
  return {
    auth: { isSuperAdmin: false, tenantId: 'tenant-a', orgId: 'org-a' },
    container: { resolve: jest.fn(() => em) },
  } as any
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Tenant schedule',
    scopeType: 'tenant',
    tenantId: 'tenant-a',
    scheduleType: 'interval',
    scheduleValue: '15m',
    targetType: 'queue',
    targetQueue: 'scheduler',
    isEnabled: true,
    ...overrides,
  }
}

describe('scheduler.jobs active schedule tenant limit', () => {
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

  it('rejects creating an enabled tenant-scoped schedule after the tenant reaches the active cap', async () => {
    const { create } = loadCommands()
    const em = makeEm(null)
    em.count.mockResolvedValue(2)

    await expect(create.execute(createInput(), makeCtx(em))).rejects.toMatchObject({ status: 422 })

    expect(em.count).toHaveBeenCalledWith(expect.any(Function), {
      tenantId: 'tenant-a',
      isEnabled: true,
      deletedAt: null,
    })
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('rejects enabling a disabled tenant-scoped schedule after the tenant reaches the active cap', async () => {
    const { update } = loadCommands()
    const schedule = {
      id: 'job-1',
      tenantId: 'tenant-a',
      organizationId: null,
      scopeType: 'tenant',
      isEnabled: false,
      scheduleType: 'interval',
      scheduleValue: '15m',
      timezone: 'UTC',
    }
    const em = makeEm(schedule)
    em.count.mockResolvedValue(2)

    await expect(update.execute({ id: 'job-1', isEnabled: true }, makeCtx(em))).rejects.toMatchObject({ status: 422 })

    expect(em.count).toHaveBeenCalledWith(expect.any(Function), {
      tenantId: 'tenant-a',
      isEnabled: true,
      deletedAt: null,
    })
    expect(schedule.isEnabled).toBe(false)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('does not count an already-enabled schedule when updating other fields', async () => {
    const { update } = loadCommands()
    const schedule = {
      id: 'job-1',
      tenantId: 'tenant-a',
      organizationId: null,
      scopeType: 'tenant',
      isEnabled: true,
      scheduleType: 'interval',
      scheduleValue: '15m',
      timezone: 'UTC',
    }
    const em = makeEm(schedule)

    await expect(update.execute({ id: 'job-1', name: 'Renamed' }, makeCtx(em))).resolves.toEqual({ ok: true })

    expect(em.count).not.toHaveBeenCalled()
    expect(schedule.name).toBe('Renamed')
    expect(em.flush).toHaveBeenCalled()
  })

  it('rejects direct command interval updates below one minute', async () => {
    const { update } = loadCommands()
    const schedule = {
      id: 'job-1',
      tenantId: 'tenant-a',
      organizationId: null,
      scopeType: 'tenant',
      isEnabled: true,
      scheduleType: 'interval',
      scheduleValue: '15m',
      timezone: 'UTC',
      nextRunAt: new Date('2026-01-01T00:15:00.000Z'),
    }
    const em = makeEm(schedule)

    await expect(
      update.execute({ id: 'job-1', scheduleType: 'interval', scheduleValue: '1s' }, makeCtx(em)),
    ).rejects.toMatchObject({ status: 422 })

    expect(schedule.scheduleValue).toBe('15m')
    expect(schedule.nextRunAt).toEqual(new Date('2026-01-01T00:15:00.000Z'))
    expect(em.flush).not.toHaveBeenCalled()
  })
})
