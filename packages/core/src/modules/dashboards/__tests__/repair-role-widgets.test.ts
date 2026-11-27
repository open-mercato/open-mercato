import { randomBytes, randomUUID } from 'node:crypto'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { Role } from '@open-mercato/core/modules/auth/data/entities'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { StartedTestContainer } from 'testcontainers'
import cli from '../cli'
import { DashboardRoleWidgets } from '../data/entities'
import en from '../i18n/en.json'
import { loadAllWidgets } from '../lib/widgets'

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: createTranslator(en) }),
}))
jest.mock('../lib/widgets', () => ({ loadAllWidgets: jest.fn() }))

const command = cli.find(({ command }) => command === 'repair-role-widgets')!
const mockContainer = jest.mocked(createRequestContainer)
const mockLoadWidgets = jest.mocked(loadAllWidgets)
const tenantId = randomUUID()
const organizationId = randomUUID()

afterEach(() => {
  jest.resetAllMocks()
  jest.restoreAllMocks()
})

test.each([
  ['missing organization', ['--tenant', tenantId, '--apply']],
  ['both scopes', ['--tenant', tenantId, '--organization', organizationId, '--tenant-wide']],
  ['tenant-wide with a value', ['--tenant', tenantId, '--tenant-wide=false']],
  ['invalid organization', ['--tenant', tenantId, '--organization', 'all', '--apply']],
  ['invalid tenant', ['--tenant', 'all', '--organization', organizationId, '--apply']],
  ['apply with a value', ['--tenant', tenantId, '--organization', organizationId, '--apply=false']],
  ['unrecognized flag', ['--tenant', tenantId, '--organization', organizationId, '--aply']],
])('rejects %s before resolving the database', async (_description, args) => {
  await expect(command.run(args)).rejects.toThrow('Usage: mercato dashboards repair-role-widgets')
  expect(mockContainer).not.toHaveBeenCalled()
})

test('opens a read-only transaction by default and leaves a healthy scope alone', async () => {
  const tx = { count: jest.fn().mockResolvedValue(1), execute: jest.fn().mockResolvedValue([]) }
  const transactional = jest.fn(async (operation: (manager: typeof tx) => Promise<unknown>) => operation(tx))
  mockContainer.mockResolvedValue({ resolve: () => ({ transactional }) } as Awaited<ReturnType<typeof createRequestContainer>>)
  const log = jest.spyOn(console, 'log').mockImplementation(() => {})

  await command.run(['--tenant', tenantId, '--organization', organizationId])

  expect(transactional).toHaveBeenCalledWith(expect.any(Function), { readOnly: true })
  expect(tx.count).toHaveBeenCalledWith(Organization, { id: organizationId, tenant: tenantId, deletedAt: null })
  expect(tx.execute).toHaveBeenCalledWith(expect.not.stringContaining('for update'), [tenantId, organizationId])
  expect(mockLoadWidgets).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith(expect.stringContaining('would remove 0 foreign role assignments and restore 0'))
})

const describePostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describePostgres('repair-role-widgets with disposable PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM
  let em: EntityManager

  const otherTenantId = randomUUID()
  const otherOrganizationId = randomUUID()
  const siblingOrganizationId = randomUUID()
  const args = ['--tenant', tenantId, '--organization', organizationId]

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    const password = randomBytes(24).toString('hex')
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_PASSWORD: password })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'postgres',
      user: 'postgres',
      password,
      entities: [DashboardRoleWidgets, Organization, Role, Tenant],
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  beforeEach(async () => {
    em = orm.em.fork()
    await em.execute('truncate dashboard_role_widgets, roles, organizations, tenants')
    const tenant = em.create(Tenant, { id: tenantId, name: 'Selected tenant' })
    const otherTenant = em.create(Tenant, { id: otherTenantId, name: 'Other tenant' })
    em.create(Organization, { id: organizationId, tenant, name: 'Selected organization' })
    em.create(Organization, { id: siblingOrganizationId, tenant, name: 'Sibling organization' })
    em.create(Organization, { id: otherOrganizationId, tenant: otherTenant, name: 'Other organization' })
    await em.flush()
    mockContainer.mockResolvedValue({ resolve: () => em.fork() } as Awaited<ReturnType<typeof createRequestContainer>>)
    mockLoadWidgets.mockResolvedValue([
      { metadata: { id: 'widget.default', title: 'Default', defaultEnabled: true } },
      { metadata: { id: 'widget.analytics', title: 'Analytics', category: 'analytics' } },
      { metadata: { id: 'widget.optional', title: 'Optional' } },
    ] as Awaited<ReturnType<typeof loadAllWidgets>>)
  })

  function addRole(scopeTenantId: string, name: string) {
    return em.create(Role, { id: randomUUID(), tenantId: scopeTenantId, name })
  }

  function addAssignment(role: Role, scopeTenantId: string, scopeOrganizationId: string | null, widgetIdsJson: string[]) {
    return em.create(DashboardRoleWidgets, {
      id: randomUUID(),
      roleId: role.id,
      tenantId: scopeTenantId,
      organizationId: scopeOrganizationId,
      widgetIdsJson,
    })
  }

  function readAssignments() {
    return em.fork().findAll(DashboardRoleWidgets, { orderBy: { id: 'asc' } })
  }

  test('previews and repairs one scope, preserving exact and fallback settings on repeat runs', async () => {
    const admin = addRole(tenantId, 'admin')
    const employee = addRole(tenantId, 'employee')
    const superadmin = addRole(tenantId, 'superadmin')
    const foreignAdmin = addRole(otherTenantId, 'admin')
    const foreignEmployee = addRole(otherTenantId, 'employee')
    const foreignSuperadmin = addRole(otherTenantId, 'superadmin')
    const invalid = [
      addAssignment(foreignAdmin, tenantId, organizationId, ['foreign.admin']),
      addAssignment(foreignEmployee, tenantId, organizationId, ['foreign.employee']),
      addAssignment(foreignSuperadmin, tenantId, organizationId, ['foreign.superadmin']),
    ]
    const preserved = [
      addAssignment(admin, tenantId, organizationId, ['custom.admin']),
      addAssignment(superadmin, tenantId, null, []),
      addAssignment(admin, otherTenantId, otherOrganizationId, ['reverse.legacy']),
      addAssignment(foreignEmployee, otherTenantId, otherOrganizationId, ['other.custom']),
      addAssignment(foreignEmployee, tenantId, siblingOrganizationId, ['sibling.legacy']),
    ]
    await em.flush()
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const before = await readAssignments()

    await command.run(args)
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('would remove 3 foreign role assignments and restore 1'))
    expect(await readAssignments()).toEqual(before)

    await expect(command.run(['--tenant', tenantId, '--organization', otherOrganizationId, '--apply']))
      .rejects.toThrow('Organization does not belong to the selected tenant')
    expect(await readAssignments()).toEqual(before)

    await command.run([...args, '--apply'])
    const repaired = await readAssignments()
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('Removed 3 foreign role assignments and restored 1'))
    expect(repaired).toHaveLength(preserved.length + 1)
    expect(repaired.filter(({ id }) => invalid.some((row) => row.id === id))).toEqual([])
    expect(repaired.filter(({ id }) => preserved.some((row) => row.id === id)))
      .toEqual(before.filter(({ id }) => preserved.some((row) => row.id === id)))
    expect(repaired.find(({ roleId }) => roleId === employee.id)).toMatchObject({
      tenantId,
      organizationId,
      widgetIdsJson: ['widget.default', 'widget.analytics'],
    })

    await command.run([...args, '--apply'])
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('Removed 0 foreign role assignments and restored 0'))
    expect(await readAssignments()).toEqual(repaired)
  })

  test('previews and repairs only tenant-wide legacy assignments', async () => {
    const employee = addRole(tenantId, 'employee')
    const admin = addRole(tenantId, 'admin')
    const foreignEmployee = addRole(otherTenantId, 'employee')
    const foreignAdmin = addRole(otherTenantId, 'admin')
    const invalid = [
      addAssignment(foreignEmployee, tenantId, null, ['legacy.employee']),
      addAssignment(foreignAdmin, tenantId, null, ['legacy.admin']),
    ]
    const preserved = [
      addAssignment(admin, tenantId, null, []),
      addAssignment(foreignEmployee, tenantId, organizationId, ['organization.legacy']),
      addAssignment(foreignEmployee, tenantId, siblingOrganizationId, ['sibling.legacy']),
      addAssignment(foreignEmployee, otherTenantId, null, ['other.custom']),
    ]
    await em.flush()
    const before = await readAssignments()
    const tenantWideArgs = ['--tenant', tenantId, '--tenant-wide']
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})

    await command.run(tenantWideArgs)
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('would remove 2 foreign role assignments and restore 1'))
    expect(await readAssignments()).toEqual(before)

    await command.run([...tenantWideArgs, '--apply'])
    const repaired = await readAssignments()
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('Removed 2 foreign role assignments and restored 1'))
    expect(repaired.filter(({ id }) => invalid.some((record) => record.id === id))).toEqual([])
    expect(repaired.filter(({ id }) => preserved.some((record) => record.id === id)))
      .toEqual(before.filter(({ id }) => preserved.some((record) => record.id === id)))
    expect(repaired.find(({ roleId }) => roleId === employee.id)).toMatchObject({
      tenantId,
      organizationId: null,
      widgetIdsJson: ['widget.default', 'widget.analytics'],
    })

    await command.run([...tenantWideArgs, '--apply'])
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('Removed 0 foreign role assignments and restored 0'))
    expect(await readAssignments()).toEqual(repaired)
  })

  test.each([organizationId, null])('restores a tombstoned exact assignment in scope %s without duplicate rows', async (scopeOrganizationId) => {
    const employee = addRole(tenantId, 'employee')
    const foreignEmployee = addRole(otherTenantId, 'employee')
    const tombstone = addAssignment(employee, tenantId, scopeOrganizationId, ['deleted.custom'])
    tombstone.deletedAt = new Date()
    const invalid = addAssignment(foreignEmployee, tenantId, scopeOrganizationId, ['legacy.employee'])
    await em.flush()
    const before = await readAssignments()
    const scopedArgs = scopeOrganizationId ? args : ['--tenant', tenantId, '--tenant-wide']
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})

    await command.run(scopedArgs)
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('would remove 1 foreign role assignments and restore 1'))
    expect(await readAssignments()).toEqual(before)

    await command.run([...scopedArgs, '--apply'])
    const repaired = await readAssignments()
    expect(repaired).toHaveLength(1)
    expect(repaired[0]).toMatchObject({
      id: tombstone.id,
      roleId: employee.id,
      tenantId,
      organizationId: scopeOrganizationId,
      deletedAt: null,
      widgetIdsJson: ['widget.default', 'widget.analytics'],
      createdAt: tombstone.createdAt,
    })
    expect(repaired.some(({ id }) => id === invalid.id)).toBe(false)

    await command.run([...scopedArgs, '--apply'])
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('Removed 0 foreign role assignments and restored 0'))
    expect(await readAssignments()).toEqual(repaired)
  })

  test('preserves a tombstone when an active empty tenant fallback already exists', async () => {
    const employee = addRole(tenantId, 'employee')
    const foreignEmployee = addRole(otherTenantId, 'employee')
    const tombstone = addAssignment(employee, tenantId, organizationId, ['deleted.custom'])
    tombstone.deletedAt = new Date()
    const fallback = addAssignment(employee, tenantId, null, [])
    const invalid = addAssignment(foreignEmployee, tenantId, organizationId, ['legacy.employee'])
    await em.flush()
    const before = await readAssignments()
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})

    await command.run([...args, '--apply'])
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('Removed 1 foreign role assignments and restored 0'))
    expect(await readAssignments()).toEqual(before.filter(({ id }) => id !== invalid.id))
    expect((await readAssignments()).find(({ id }) => id === fallback.id)?.widgetIdsJson).toEqual([])
  })

  test('rejects missing and deleted tenants in tenant-wide mode before inspecting assignments', async () => {
    const deletedTenant = em.create(Tenant, { id: randomUUID(), name: 'Deleted tenant', deletedAt: new Date() })
    await em.flush()
    for (const missingTenantId of [randomUUID(), deletedTenant.id]) {
      await expect(command.run(['--tenant', missingTenantId, '--tenant-wide', '--apply']))
        .rejects.toThrow('Tenant does not exist or has been deleted')
    }
    expect(mockLoadWidgets).not.toHaveBeenCalled()
    expect(await readAssignments()).toEqual([])
  })

  test('leaves repairable rows intact if the widget registry is unavailable', async () => {
    addRole(tenantId, 'employee')
    const foreignEmployee = addRole(otherTenantId, 'employee')
    addAssignment(foreignEmployee, tenantId, organizationId, ['foreign.employee'])
    await em.flush()
    const before = await readAssignments()
    mockLoadWidgets.mockResolvedValue([])

    await expect(command.run([...args, '--apply'])).rejects.toThrow('Dashboard widgets are unavailable')
    expect(await readAssignments()).toEqual(before)
  })
})
