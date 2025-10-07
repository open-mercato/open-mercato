/** @jest-environment node */
import cli from '@open-mercato/core/modules/auth/cli'

// Mock DI container and EM
const persistAndFlush = jest.fn()
const findOne = jest.fn()
const findOneOrFail = jest.fn()
const create = jest.fn((entity: any, data: any) => ({ ...data }))
const find = jest.fn()
const persist = jest.fn()
const flush = jest.fn()

jest.mock('@/lib/di/container', () => ({
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

  it('creates role ACL rows for owner/admin/employee', async () => {
    const setup = cli.find((c: any) => c.command === 'setup')!

    // Arrange mocks: roles exist
    findOne.mockImplementation(async (Entity: any, where: any) => {
      if (where?.name === 'owner') return { id: 'r-owner', name: 'owner' }
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
    // owner -> isSuperAdmin
    expect(roleAclCreates.some((row) => row.isSuperAdmin === true)).toBe(true)
    // admin -> featuresJson ['*']
    expect(roleAclCreates.some((row) => Array.isArray(row.featuresJson) && row.featuresJson.includes('*'))).toBe(true)
    // employee -> featuresJson ['example.*']
    expect(roleAclCreates.some((row) => Array.isArray(row.featuresJson) && row.featuresJson.includes('example.*'))).toBe(true)
  })
})


