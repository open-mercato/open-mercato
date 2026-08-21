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
  { id: 'customers', setup: { defaultRoleFeatures: { admin: ['customers.*'] } } },
  { id: 'directory', setup: { defaultRoleFeatures: { admin: ['directory.*'] } } },
  { id: 'entities', setup: { defaultRoleFeatures: { admin: ['entities.*'] } } },
]
registerModules(testModules)
registerCliModules(testModules)

const findOne = jest.fn()
const findOneOrFail = jest.fn(async (_: any, where: any) => ({ id: 'role-' + where.name, name: where.name }))
const create = jest.fn((entity: any, data: any) => {
  if (entity?.name === 'Tenant') return { id: 'tenant-1', ...data }
  if (entity?.name === 'Organization') return { id: 'org-1', ...data }
  return { ...data }
})
const find = jest.fn(async () => [])
const persist = jest.fn(function persist(this: any) {
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

const SECRET_PASSWORD = 'sup3r-s3cret-pw'

const BASE_ARGS = [
  '--orgName', 'Acme',
  '--email', 'root@acme.com',
  '--password', SECRET_PASSWORD,
  '--skip-password-policy',
]

describe('mercato auth setup — password is never echoed to stdout', () => {
  let logSpy: jest.SpyInstance
  let stdoutSpy: jest.SpyInstance
  let stderrSpy: jest.SpyInstance
  let originalExitCode: number | string | undefined
  let originalNodeEnv: string | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    originalExitCode = process.exitCode
    process.exitCode = undefined
    // The plaintext-echo path only runs when NODE_ENV !== 'test'; force a
    // production-like value so the regression is actually exercised.
    originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
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
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
    logSpy.mockRestore()
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('does not print the supplied password on the created-user banner', async () => {
    await setupCommand.run([...BASE_ARGS])

    const consolePayload = logSpy.mock.calls.map((c) => c.map((a) => String(a)).join(' ')).join('\n')
    const stdoutPayload = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
    const stderrPayload = stderrSpy.mock.calls.map((c) => String(c[0])).join('')

    expect(consolePayload).not.toContain(SECRET_PASSWORD)
    expect(stdoutPayload).not.toContain(SECRET_PASSWORD)
    expect(stderrPayload).not.toContain(SECRET_PASSWORD)
    // Sanity: the created-user banner still renders (just without the secret).
    expect(consolePayload).toContain('Created user')
    expect(consolePayload).toContain('root@acme.com')
  })
})
