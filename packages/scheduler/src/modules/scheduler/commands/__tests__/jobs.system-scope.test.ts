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
  return {
    fork: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockResolvedValue(schedule),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    create: jest.fn(),
  }
}

function makeCtx(auth: Record<string, unknown> | null, em: any) {
  return {
    auth,
    container: { resolve: jest.fn(() => em) },
  } as any
}

describe('scheduler.jobs system-scope authorization (issue #2267)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('blocks a non-super-admin from creating a system-scoped job', async () => {
    const { create } = loadCommands()
    expect(create).toBeDefined()
    const em = makeEm(null)
    const ctx = makeCtx({ isSuperAdmin: false, tenantId: 'tenant-a', roles: ['admin'] }, em)

    await expect(
      create.execute(
        { name: 'sys', scopeType: 'system', tenantId: null, scheduleType: 'cron', scheduleValue: '* * * * *', targetType: 'queue' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('blocks a non-super-admin from updating a system-scoped job and performs no write', async () => {
    const { update } = loadCommands()
    const em = makeEm({ id: 'job-1', scopeType: 'system', tenantId: null, organizationId: null })
    const ctx = makeCtx({ isSuperAdmin: false, tenantId: 'tenant-a', roles: ['admin'] }, em)

    await expect(
      update.execute({ id: 'job-1', name: 'hijacked' }, ctx),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('blocks a non-super-admin from deleting a system-scoped job and performs no write', async () => {
    const { del } = loadCommands()
    const em = makeEm({ id: 'job-1', scopeType: 'system', tenantId: null, organizationId: null })
    const ctx = makeCtx({ isSuperAdmin: false, tenantId: 'tenant-a', roles: ['admin'] }, em)

    await expect(
      del.execute({ id: 'job-1' }, ctx),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
  })

  it('blocks an actor whose role is literally named "superadmin" but lacks the isSuperAdmin flag (no role-name spoofing)', async () => {
    const { del } = loadCommands()
    const em = makeEm({ id: 'job-1', scopeType: 'system', tenantId: null, organizationId: null })
    const ctx = makeCtx({ isSuperAdmin: false, tenantId: 'tenant-a', roles: ['superadmin'] }, em)

    await expect(
      del.execute({ id: 'job-1' }, ctx),
    ).rejects.toMatchObject({ status: 403 })
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
  })

  it('allows a super-admin to delete a system-scoped job (not blocked by the guard)', async () => {
    const { del } = loadCommands()
    const em = makeEm({ id: 'job-1', scopeType: 'system', tenantId: null, organizationId: null })
    const ctx = makeCtx({ isSuperAdmin: true, tenantId: null, roles: ['superadmin'] }, em)

    const result = await del.execute({ id: 'job-1' }, ctx)
    expect(result).toEqual({ ok: true })
    expect(em.flush).toHaveBeenCalled()
  })

  it('does NOT block a same-tenant non-super-admin from deleting a tenant-scoped job', async () => {
    const { del } = loadCommands()
    const em = makeEm({ id: 'job-2', scopeType: 'tenant', tenantId: 'tenant-a', organizationId: null })
    const ctx = makeCtx({ isSuperAdmin: false, tenantId: 'tenant-a', roles: ['admin'] }, em)

    const result = await del.execute({ id: 'job-2' }, ctx)
    expect(result).toEqual({ ok: true })
    expect(em.flush).toHaveBeenCalled()
  })
})
