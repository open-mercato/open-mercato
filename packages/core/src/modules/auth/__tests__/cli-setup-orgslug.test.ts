/** @jest-environment node */
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerCliModules } from '@open-mercato/shared/modules/registry'
import type { Module } from '@open-mercato/shared/modules/registry'
import cli from '@open-mercato/core/modules/auth/cli'

const seedExamplesAuth = jest.fn(async () => undefined)
const seedExamplesCustomers = jest.fn(async () => undefined)

const testModules: Module[] = [
  { id: 'auth', setup: { defaultRoleFeatures: { admin: ['auth.*'] }, seedExamples: seedExamplesAuth } },
  { id: 'customers', setup: { defaultRoleFeatures: { admin: ['customers.*'] }, seedExamples: seedExamplesCustomers } },
  { id: 'directory', setup: { defaultRoleFeatures: { admin: ['directory.*'] } } },
  { id: 'entities', setup: { defaultRoleFeatures: { admin: ['entities.*'] } } },
]
registerModules(testModules)
registerCliModules(testModules)

const persistedEntities: any[] = []
const findOne = jest.fn()
const findOneOrFail = jest.fn(async (_: any, where: any) => ({ id: 'role-' + where.name, name: where.name }))
const create = jest.fn((entity: any, data: any) => {
  if (entity?.name === 'Tenant') return { id: 'tenant-1', ...data }
  if (entity?.name === 'Organization') return { id: 'org-1', ...data }
  return { ...data }
})
const find = jest.fn(async () => [])
const persist = jest.fn(function persist(this: any, entity: any) {
  persistedEntities.push(entity)
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
  '--password', 'secret',
  '--skip-password-policy',
]

describe('mercato auth setup --orgSlug', () => {
  let stdoutSpy: jest.SpyInstance
  let stderrSpy: jest.SpyInstance
  let originalExitCode: number | string | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    persistedEntities.length = 0
    originalExitCode = process.exitCode
    process.exitCode = undefined
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
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
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('rejects invalid slug format with usage error and exit 2', async () => {
    await setupCommand.run([...BASE_ARGS, '--orgSlug', 'Foo Bar'])
    expect(process.exitCode).toBe(2)
    expect(persistedEntities).toHaveLength(0)
    const stderrPayload = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(stderrPayload).toContain('Invalid --orgSlug')
  })

  it('throws OrgSlugExistsError when an organization with that slug already exists, exit 1', async () => {
    findOne.mockImplementation(async (Entity: any, where: any) => {
      const name = (Entity && Entity.name) || ''
      if (name === 'Organization' && where?.slug === 'taken') {
        return { id: 'pre-existing-org', slug: 'taken' }
      }
      if (name === 'Role') {
        if (where?.name === 'superadmin') return { id: 'r-superadmin', name: 'superadmin' }
      }
      return null
    })
    await setupCommand.run([...BASE_ARGS, '--orgSlug', 'taken', '--json'])
    expect(process.exitCode).toBe(1)
    expect(stdoutSpy).not.toHaveBeenCalled()
    const stderrPayload = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(stderrPayload).toContain('ORG_SLUG_EXISTS')
    expect(stderrPayload).toContain('taken')
  })

  it('persists the slug onto the new Organization when no collision', async () => {
    await setupCommand.run([...BASE_ARGS, '--orgSlug', 'fresh'])
    const orgPayload = persistedEntities.find((row) => row && row.slug === 'fresh' && row.name === 'Acme')
    expect(orgPayload).toBeDefined()
    expect(orgPayload.slug).toBe('fresh')
  })

  it('emits a single JSON line to stdout in --json mode and suppresses banners', async () => {
    await setupCommand.run([...BASE_ARGS, '--orgSlug', 'fresh', '--json'])
    expect(process.exitCode).toBeUndefined()
    const stdoutWrites = stdoutSpy.mock.calls.map((c) => String(c[0]))
    expect(stdoutWrites).toHaveLength(1)
    const payload = JSON.parse(stdoutWrites[0]!.trim())
    expect(payload).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      adminEmail: 'root@acme.com',
      reusedExistingUser: false,
    })
    expect(payload.adminUserId === null || typeof payload.adminUserId === 'string').toBe(true)
    expect(process.env.OM_CLI_QUIET).toBe('1')
  })

  it('--with-examples invokes each module seedExamples after tenant create', async () => {
    await setupCommand.run([...BASE_ARGS, '--orgSlug', 'fresh', '--with-examples', '--json'])
    expect(seedExamplesAuth).toHaveBeenCalledTimes(1)
    expect(seedExamplesCustomers).toHaveBeenCalledTimes(1)
    const ctx = seedExamplesAuth.mock.calls[0]![0] as any
    expect(ctx).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(typeof ctx.em).toBe('object')
    expect(typeof ctx.container).toBe('object')
  })

  it('treats --orgSlug as a "fresh tenant" signal: existing user with that email aborts with USER_EXISTS, exit 1', async () => {
    findOne.mockImplementation(async (Entity: any, where: any) => {
      const name = (Entity && Entity.name) || ''
      if (name === 'User' && where?.email === 'reused@acme.com') {
        return {
          id: 'pre-existing-user',
          email: 'reused@acme.com',
          tenantId: 'foreign-tenant',
          organizationId: 'foreign-org',
        }
      }
      if (name === 'Organization') return null
      if (name === 'Role') {
        if (where?.name === 'superadmin') return { id: 'r-superadmin', name: 'superadmin' }
      }
      return null
    })
    await setupCommand.run([
      '--orgName', 'Acme',
      '--email', 'reused@acme.com',
      '--password', 'secret',
      '--skip-password-policy',
      '--orgSlug', 'fresh',
      '--json',
    ])
    expect(process.exitCode).toBe(1)
    expect(stdoutSpy).not.toHaveBeenCalled()
    const stderrPayload = stderrSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(stderrPayload).toContain('user already exists')
  })

  it('without --orgSlug, retains the legacy reuse behaviour (no failIfUserExists)', async () => {
    findOne.mockImplementation(async (Entity: any, where: any) => {
      const name = (Entity && Entity.name) || ''
      if (name === 'User' && where?.email === 'reused@acme.com') {
        return {
          id: 'pre-existing-user',
          email: 'reused@acme.com',
          tenantId: 'foreign-tenant',
          organizationId: 'foreign-org',
        }
      }
      if (name === 'Role') {
        if (where?.name === 'superadmin') return { id: 'r-superadmin', name: 'superadmin' }
        if (where?.name === 'admin') return { id: 'r-admin', name: 'admin' }
        if (where?.name === 'employee') return { id: 'r-employee', name: 'employee' }
      }
      return null
    })
    await setupCommand.run([
      '--orgName', 'Acme',
      '--email', 'reused@acme.com',
      '--password', 'secret',
      '--skip-password-policy',
    ])
    expect(process.exitCode).toBeUndefined()
  })
})
