/** @jest-environment node */
import cli from '@open-mercato/core/modules/auth/cli'

// Mock DI container and EM
const persistAndFlush = jest.fn()
const findOne = jest.fn()
const findOneOrFail = jest.fn()
const create = jest.fn((entity: any, data: any) => {
  if (entity?.name === 'Tenant') return { id: 'tenant-1', ...data }
  if (entity?.name === 'Organization') return { id: 'org-1', ...data }
  return { ...data }
})
const find = jest.fn(async () => [])
const persist = jest.fn()
const flush = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (_: string) => {
    const baseEm = { persistAndFlush, findOne, findOneOrFail, create, find, persist, flush }
    return {
      ...baseEm,
      transactional: async (cb: (tem: any) => any) => {
        // Provide a transactional EM with persist/flush methods
        const tem = { ...baseEm }
        return await cb(tem)
      },
    }
  } }),
}))

describe('auth CLI setup seeds ACLs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('creates role ACL rows for superadmin/admin/employee', async () => {
    const setup = cli.find((c: any) => c.command === 'setup')!

    // Arrange mocks: roles exist
    findOne.mockImplementation(async (Entity: any, where: any) => {
      if (where?.name === 'superadmin') return { id: 'r-superadmin', name: 'superadmin' }
      if (where?.name === 'admin') return { id: 'r-admin', name: 'admin' }
      if (where?.name === 'employee') return { id: 'r-employee', name: 'employee' }
      return null
    })
    findOneOrFail.mockImplementation(async (_: any, where: any) => ({ id: 'role-' + where.name, name: where.name }))

    // Act
    await setup.run(['--orgName', 'Acme', '--email', 'root@acme.com', '--password', 'secret'])

    // Assert: persistAndFlush was called to create three RoleAcl rows with expected flags/features
    const calls = persistAndFlush.mock.calls.map((c) => c[0])
    const roleAclCreates = calls.filter((row) => 'tenantId' in row && ('isSuperAdmin' in row || Array.isArray(row.featuresJson)))
    const superadminAcl = roleAclCreates.find((row) => row.isSuperAdmin === true)
    expect(superadminAcl).toBeDefined()
    expect(Array.isArray(superadminAcl?.featuresJson)).toBe(true)
    expect(superadminAcl?.featuresJson).toEqual(expect.arrayContaining(['directory.tenants.*']))

    const adminAcl = roleAclCreates.find((row) => Array.isArray(row.featuresJson) && row.featuresJson.includes('directory.organizations.manage'))
    expect(adminAcl).toBeDefined()
    expect(adminAcl?.featuresJson).toEqual(expect.arrayContaining([
      'auth.*',
      'entities.*',
      'attachments.*',
      'query_index.*',
      'vector.*',
      'catalog.*',
      'sales.*',
      'configs.system_status.view',
      'configs.cache.view',
      'configs.cache.manage',
      'configs.manage',
      'directory.organizations.manage',
      'directory.organizations.view',
      'customers.*',
      'customers.people.view',
      'customers.people.manage',
      'customers.companies.view',
      'customers.companies.manage',
      'dictionaries.view',
      'dictionaries.manage',
      'example.*',
      'audit_logs.*',
      'dashboards.*',
      'dashboards.admin.assign-widgets',
      'api_keys.*',
      'perspectives.use',
      'perspectives.role_defaults',
    ]))
    expect(adminAcl?.featuresJson).not.toContain('directory.organizations.*')

    const employeeAcl = roleAclCreates.find((row) => Array.isArray(row.featuresJson) && row.featuresJson.includes('example.widgets.*'))
    expect(employeeAcl).toBeDefined()
    expect(employeeAcl?.featuresJson).toEqual(expect.arrayContaining([
      'customers.*',
      'customers.people.view',
      'customers.people.manage',
      'customers.companies.view',
      'customers.companies.manage',
      'vector.*',
      'catalog.*',
      'sales.*',
      'dictionaries.view',
      'example.*',
      'example.widgets.*',
      'dashboards.view',
      'dashboards.configure',
      'audit_logs.undo_self',
      'perspectives.use',
    ]))
  })
})
