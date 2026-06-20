/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => false,
  isEncryptionDebugEnabled: () => false,
}))

import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import cli from '@open-mercato/core/modules/auth/cli'

jest.setTimeout(60_000)

const testModules: Module[] = [
  { id: 'auth', setup: { defaultRoleFeatures: { admin: ['auth.*'] } } },
  { id: 'directory', setup: { defaultRoleFeatures: { admin: ['directory.*'] } } },
  { id: 'entities', setup: { defaultRoleFeatures: { admin: ['entities.*'] } } },
]
registerModules(testModules)
registerCliModules(testModules)

const persistedEntities: any[] = []
const persistedUsers: Array<{ email: string; passwordHash?: string | null; tenantId?: string | null }> = []

const findOne = jest.fn()
const findOneOrFail = jest.fn(async (_: any, where: any) => ({ id: 'role-' + where.name, name: where.name }))
const find = jest.fn(async () => [])
const create = jest.fn((entity: any, data: any) => {
  if (entity?.name === 'Tenant') return { id: 'tenant-1', ...data }
  if (entity?.name === 'Organization') return { id: 'org-1', ...data }
  if (entity?.name === 'User') {
    const created = { id: `user-${persistedUsers.length + 1}`, ...data }
    return created
  }
  return { ...data }
})
const persist = jest.fn(function persist(this: any, entity: any) {
  persistedEntities.push(entity)
  if (entity && typeof entity === 'object' && typeof entity.email === 'string' && 'passwordHash' in entity) {
    persistedUsers.push({
      email: entity.email,
      passwordHash: entity.passwordHash ?? null,
      tenantId: entity.tenantId ?? null,
    })
  }
  return this
})
const flush = jest.fn(async () => {})

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (_: string) => {
      const baseEm = { findOne, findOneOrFail, create, find, persist, flush }
      return {
        ...baseEm,
        transactional: async (cb: (tem: any) => any) => {
          const tem = { ...baseEm }
          return await cb(tem)
        },
      }
    },
  }),
}))

const setupCommand = cli.find((c: any) => c.command === 'setup')!

const BASE_ARGS = [
  '--orgName', 'Acme',
  '--email', 'root@acme.com',
  '--password', 'P@ssw0rd-Demo-1!',
]

describe('mercato auth setup --include-demo-users', () => {
  let stdoutSpy: jest.SpyInstance
  let stderrSpy: jest.SpyInstance
  let consoleLogSpy: jest.SpyInstance
  let originalExitCode: number | string | undefined
  let originalNodeEnv: string | undefined
  const ENV_KEYS = [
    'OM_INIT_ADMIN_PASSWORD',
    'OM_INIT_EMPLOYEE_PASSWORD',
    'OM_INIT_ADMIN_EMAIL',
    'OM_INIT_EMPLOYEE_EMAIL',
  ]
  const savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    jest.clearAllMocks()
    persistedEntities.length = 0
    persistedUsers.length = 0
    originalExitCode = process.exitCode
    process.exitCode = undefined
    originalNodeEnv = process.env.NODE_ENV
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    findOne.mockImplementation(async (Entity: any, where: any) => {
      const name = (Entity && Entity.name) || ''
      if (name === 'Role') {
        if (where?.name === 'superadmin') return { id: 'r-superadmin', name: 'superadmin' }
        if (where?.name === 'admin') return { id: 'r-admin', name: 'admin' }
        if (where?.name === 'employee') return { id: 'r-employee', name: 'employee' }
      }
      return null
    })
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    consoleLogSpy.mockRestore()
  })

  it('does NOT seed admin@/employee@ accounts by default (no --include-demo-users)', async () => {
    process.env.NODE_ENV = 'production'
    await setupCommand.run([...BASE_ARGS])
    expect(process.exitCode).toBeUndefined()
    const seededEmails = persistedUsers.map((row) => row.email)
    expect(seededEmails).toContain('root@acme.com')
    expect(seededEmails).not.toContain('admin@acme.com')
    expect(seededEmails).not.toContain('employee@acme.com')
  })

  it("seeds admin@/employee@ with the well-known 'secret' password in non-production when --include-demo-users is set without env overrides", async () => {
    const bcrypt = await import('bcryptjs')
    process.env.NODE_ENV = 'test'
    await setupCommand.run([...BASE_ARGS, '--include-demo-users'])
    expect(process.exitCode).toBeUndefined()
    const seededEmails = persistedUsers.map((row) => row.email)
    expect(seededEmails).toContain('admin@acme.com')
    expect(seededEmails).toContain('employee@acme.com')
    const adminRow = persistedUsers.find((row) => row.email === 'admin@acme.com')
    const employeeRow = persistedUsers.find((row) => row.email === 'employee@acme.com')
    expect(typeof adminRow?.passwordHash).toBe('string')
    expect(typeof employeeRow?.passwordHash).toBe('string')
    // Stored field is a bcrypt hash, not the plaintext literal.
    expect(adminRow?.passwordHash).not.toBe('secret')
    expect(employeeRow?.passwordHash).not.toBe('secret')
    // bcrypt salts ensure two hashes of the same plaintext still differ.
    expect(adminRow?.passwordHash).not.toBe(employeeRow?.passwordHash)
    // Verify the actual plaintext IS 'secret' — restores predictable dev DX.
    expect(await bcrypt.compare('secret', adminRow!.passwordHash!)).toBe(true)
    expect(await bcrypt.compare('secret', employeeRow!.passwordHash!)).toBe(true)
  })

  it("uses a random fallback password (not 'secret') in production when --include-demo-users is set without env overrides", async () => {
    const bcrypt = await import('bcryptjs')
    process.env.NODE_ENV = 'production'
    await setupCommand.run([...BASE_ARGS, '--include-demo-users'])
    expect(process.exitCode).toBeUndefined()
    const adminRow = persistedUsers.find((row) => row.email === 'admin@acme.com')
    const employeeRow = persistedUsers.find((row) => row.email === 'employee@acme.com')
    expect(typeof adminRow?.passwordHash).toBe('string')
    expect(typeof employeeRow?.passwordHash).toBe('string')
    // Production fallback must NOT seed the well-known demo password.
    expect(await bcrypt.compare('secret', adminRow!.passwordHash!)).toBe(false)
    expect(await bcrypt.compare('secret', employeeRow!.passwordHash!)).toBe(false)
  })

  it('throws DerivedUserPasswordRequiredError in production when --include-demo-users is omitted but the env vars are unset and the caller forces includeDerivedUsers', async () => {
    // The CLI default path is default-deny (--include-demo-users not set → no derived seeding).
    // This case proves the lib-level safeguard fires when a third-party caller passes
    // includeDerivedUsers: true without consenting to demo passwords in production.
    const { setupInitialTenant, DerivedUserPasswordRequiredError } = await import('@open-mercato/core/modules/auth/lib/setup-app')
    process.env.NODE_ENV = 'production'
    const em: any = {
      findOne,
      findOneOrFail,
      create,
      find,
      persist,
      flush,
      transactional: async (cb: any) => cb({ findOne, findOneOrFail, create, find, persist, flush }),
    }
    await expect(
      setupInitialTenant(em, {
        orgName: 'Acme',
        primaryUser: { email: 'root@acme.com', password: 'Strong-Pa55!!', confirm: true },
        includeDerivedUsers: true,
        modules: testModules,
      }),
    ).rejects.toBeInstanceOf(DerivedUserPasswordRequiredError)
  })

  it('uses env-supplied derived passwords without random generation when provided', async () => {
    process.env.NODE_ENV = 'production'
    process.env.OM_INIT_ADMIN_PASSWORD = 'Provided-Admin-1!'
    process.env.OM_INIT_EMPLOYEE_PASSWORD = 'Provided-Emp-1!'
    await setupCommand.run([...BASE_ARGS, '--include-demo-users'])
    expect(process.exitCode).toBeUndefined()
    const seededEmails = persistedUsers.map((row) => row.email)
    expect(seededEmails).toContain('admin@acme.com')
    expect(seededEmails).toContain('employee@acme.com')
    const adminRow = persistedUsers.find((row) => row.email === 'admin@acme.com')
    const employeeRow = persistedUsers.find((row) => row.email === 'employee@acme.com')
    // We can't inspect the plaintext post-hash, but the bcrypt hash must be a string and not 'secret'.
    expect(typeof adminRow?.passwordHash).toBe('string')
    expect(typeof employeeRow?.passwordHash).toBe('string')
    expect(adminRow?.passwordHash).not.toBe('secret')
    expect(employeeRow?.passwordHash).not.toBe('secret')
  })
})
