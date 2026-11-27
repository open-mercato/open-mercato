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

jest.mock('@open-mercato/shared/lib/modules/registry', () => ({
  getModules: () => [{
    id: 'scheduler_fixture',
    workers: [
      { queue: 'scheduler-test', schedulerSafe: true },
      { queue: 'module-fixture', schedulerSafe: false },
    ],
  }],
}))

function loadCommands() {
  let update: any
  jest.isolateModules(() => {
    require('../jobs')
    update = registerCommand.mock.calls.find(([cmd]) => cmd.id === 'scheduler.jobs.update')?.[0]
  })
  return update
}

const safeQueueRow = {
  id: 'job-1',
  name: 'QA queue schedule',
  scopeType: 'organization',
  tenantId: 'tenant-a',
  organizationId: 'org-a',
  isEnabled: true,
  scheduleType: 'interval',
  scheduleValue: '15m',
  timezone: 'UTC',
  targetType: 'queue',
  targetQueue: 'scheduler-test',
  targetCommand: null,
  // nested payload the UI round-trips verbatim
  targetPayload: { source: 'integration-test', retries: { max: 5 } },
  sourceType: 'user',
  sourceModule: null,
}

const moduleOwnedRow = {
  ...safeQueueRow,
  id: 'job-module',
  name: 'Module-owned schedule',
  sourceType: 'module',
  sourceModule: 'legacy_module',
  createdByUserId: null,
}

function makeEm(schedule: Record<string, unknown>) {
  return {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockResolvedValue(schedule),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(0),
  }
}

describe('scheduler.jobs.update target-change detection (#5213 N1)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('allows an operational-only save of a module-authored schedule whose form resends the unchanged target', async () => {
    const update = loadCommands()
    const em = makeEm(moduleOwnedRow)
    const ctx = {
      auth: { isSuperAdmin: false, tenantId: 'tenant-a', orgId: 'org-a', sub: 'user-1' },
      container: { resolve: jest.fn(() => em) },
    }

    const result = await update.execute(
      {
        id: moduleOwnedRow.id,
        // the shipped edit form always resends every field…
        targetType: moduleOwnedRow.targetType,
        targetQueue: moduleOwnedRow.targetQueue,
        targetPayload: moduleOwnedRow.targetPayload,
        // …while the operator only changed operational values
        name: 'Renamed by ops',
        scheduleValue: '30m',
        scheduleType: 'interval',
        isEnabled: false,
      },
      ctx,
    )

    expect(result).toEqual({ ok: true })
    expect(em.flush).toHaveBeenCalled()
  })

  it('still blocks an actual target or payload change on a module-authored schedule', async () => {
    const update = loadCommands()
    const em = makeEm(moduleOwnedRow)
    const ctx = {
      auth: { isSuperAdmin: false, tenantId: 'tenant-a', orgId: 'org-a', sub: 'user-1' },
      container: { resolve: jest.fn(() => em) },
    }

    await expect(
      update.execute({ id: moduleOwnedRow.id, targetQueue: 'stripe-webhook' }, ctx),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      update.execute({ id: moduleOwnedRow.id, targetPayload: { forged: true } }, ctx),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('lets admins disable a legacy user-authored row whose stored queue is no longer approved (#5213 N1)', async () => {
    const update = loadCommands()
    const legacyUnsafe = {
      ...safeQueueRow,
      id: 'job-legacy',
      targetQueue: 'stripe-webhook',
      targetPayload: null as unknown,
    }
    const em = makeEm(legacyUnsafe)
    const ctx = {
      auth: { isSuperAdmin: false, tenantId: 'tenant-a', orgId: 'org-a', sub: 'user-1' },
      container: { resolve: jest.fn(() => em) },
    }

    // the shipped edit form resends every field — target fields included —
    // while only flipping the switch
    const result = await update.execute(
      {
        id: legacyUnsafe.id,
        targetType: legacyUnsafe.targetType,
        targetQueue: legacyUnsafe.targetQueue,
        isEnabled: false,
      },
      ctx,
    )
    expect(result).toEqual({ ok: true })
    expect(legacyUnsafe.isEnabled).toBe(false)
    expect(em.flush).toHaveBeenCalledTimes(1)

    // retargeting onto another unapproved queue is still rejected
    await expect(
      update.execute({ id: legacyUnsafe.id, targetQueue: 'payment-gateways-webhook' }, ctx),
    ).rejects.toMatchObject({ status: 422 })
  })

  it.each([
    { storedEnabled: false, requestedEnabled: true },
    { storedEnabled: true, requestedEnabled: undefined },
  ])('requires approval when the saved queue schedule would be enabled ($storedEnabled → $requestedEnabled)', async ({
    storedEnabled,
    requestedEnabled,
  }) => {
    const update = loadCommands()
    const schedule = { ...safeQueueRow, targetQueue: 'unapproved-fixture', isEnabled: storedEnabled }
    const em = makeEm(schedule)
    const ctx = {
      auth: { isSuperAdmin: false, tenantId: 'tenant-a', orgId: 'org-a', sub: 'user-1' },
      container: { resolve: jest.fn(() => em) },
    }

    await expect(update.execute({ id: schedule.id, isEnabled: requestedEnabled }, ctx))
      .rejects.toMatchObject({ status: 422 })
    expect(schedule.isEnabled).toBe(storedEnabled)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it.each([
    { ...safeQueueRow, isEnabled: false },
    { ...moduleOwnedRow, sourceModule: 'scheduler_fixture', targetQueue: 'module-fixture', isEnabled: false },
  ])('enables $sourceType schedules with an eligible target', async (fixture) => {
    const update = loadCommands()
    const schedule = { ...fixture }
    const em = makeEm(schedule)
    const ctx = {
      auth: { isSuperAdmin: false, tenantId: 'tenant-a', orgId: 'org-a', sub: 'user-1' },
      container: { resolve: jest.fn(() => em) },
    }

    await expect(update.execute({ id: schedule.id, isEnabled: true }, ctx)).resolves.toEqual({ ok: true })
    expect(schedule.isEnabled).toBe(true)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('allows re-enabling a schedule when its queue is corrected in the same update', async () => {
    const update = loadCommands()
    const schedule = { ...safeQueueRow, targetQueue: 'unapproved-fixture', isEnabled: false }
    const em = makeEm(schedule)
    const ctx = {
      auth: { isSuperAdmin: false, tenantId: 'tenant-a', orgId: 'org-a', sub: 'user-1' },
      container: { resolve: jest.fn(() => em) },
    }

    await expect(update.execute({
      id: schedule.id,
      targetQueue: safeQueueRow.targetQueue,
      isEnabled: true,
    }, ctx)).resolves.toEqual({ ok: true })
    expect(schedule).toMatchObject({ isEnabled: true, targetQueue: safeQueueRow.targetQueue })
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  it('treats an empty-object stored payload as equal to the null the form submits (#5213 N1-residual)', async () => {
    const update = loadCommands()
    const emptyPayloadRow = {
      ...moduleOwnedRow,
      id: 'job-module-empty-payload',
      targetPayload: {},
    }
    const em = makeEm(emptyPayloadRow)
    const ctx = {
      auth: { isSuperAdmin: true, tenantId: null, orgId: null, sub: 'super-1' },
      container: { resolve: jest.fn(() => em) },
    }

    // ai_assistant-style registration stores `targetPayload: {}`; the edit form
    // normalizes that to `targetPayload: null` on submit. An operational save
    // must not trip the module-owned-target guard over the shape difference.
    const result = await update.execute(
      {
        id: emptyPayloadRow.id,
        targetType: emptyPayloadRow.targetType,
        targetQueue: emptyPayloadRow.targetQueue,
        targetPayload: null,
        name: 'Renamed by ops',
        isEnabled: true,
      },
      ctx,
    )

    expect(result).toEqual({ ok: true })
    expect(em.flush).toHaveBeenCalled()
  })
})
