/** @jest-environment node */
jest.mock('@open-mercato/shared/lib/encryption/toggles', () => ({
  isTenantDataEncryptionEnabled: () => false,
  isEncryptionDebugEnabled: () => false,
}))

import cli from '@open-mercato/core/modules/auth/cli'

const ORG_ID = 'aaaa1111-2222-3333-4444-555566667777'
const TENANT_ID = 'bbbb8888-9999-0000-1111-222233334444'

const find = jest.fn()
const findOne = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (_: string) => ({ find, findOne }),
  }),
}))

const listUsersCommand = cli.find((c: any) => c.command === 'list-users')!

const baseUser = {
  id: 'cccc0000-1111-2222-3333-444455556666',
  email: 'user@example.com',
  name: 'Test User',
  organizationId: ORG_ID,
  tenantId: TENANT_ID,
}

describe('mercato auth list-users org/tenant name fallback', () => {
  let logSpy: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    find.mockImplementation(async (Entity: any) => {
      const entityName = (Entity && Entity.name) || ''
      if (entityName === 'User') return [baseUser]
      return []
    })
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  function loggedOutput(): string {
    return logSpy.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
  }

  it('falls back to the id prefix when org/tenant rows have no name', async () => {
    findOne.mockImplementation(async (Entity: any) => {
      const entityName = (Entity && Entity.name) || ''
      if (entityName === 'Organization') return { id: ORG_ID, name: null }
      if (entityName === 'Tenant') return { id: TENANT_ID, name: null }
      return null
    })

    await listUsersCommand.run([])

    const output = loggedOutput()
    expect(output).not.toContain('undefined...')
    expect(output).toContain(`${ORG_ID.substring(0, 8)}...`)
    expect(output).toContain(`${TENANT_ID.substring(0, 8)}...`)
  })

  it('falls back to the id prefix when org/tenant lookups return nothing', async () => {
    findOne.mockResolvedValue(null)

    await listUsersCommand.run([])

    const output = loggedOutput()
    expect(output).not.toContain('undefined...')
    expect(output).toContain(`${ORG_ID.substring(0, 8)}...`)
    expect(output).toContain(`${TENANT_ID.substring(0, 8)}...`)
  })

  it('keeps showing the truncated name when org/tenant rows are named', async () => {
    findOne.mockImplementation(async (Entity: any) => {
      const entityName = (Entity && Entity.name) || ''
      if (entityName === 'Organization') return { id: ORG_ID, name: 'Acme Corporation International' }
      if (entityName === 'Tenant') return { id: TENANT_ID, name: 'Primary Tenant Holdings Group' }
      return null
    })

    await listUsersCommand.run([])

    const output = loggedOutput()
    expect(output).toContain(`${'Acme Corporation International'.substring(0, 19)}...`)
    expect(output).toContain(`${'Primary Tenant Holdings Group'.substring(0, 19)}...`)
    expect(output).not.toContain(`${ORG_ID.substring(0, 8)}...`)
    expect(output).not.toContain(`${TENANT_ID.substring(0, 8)}...`)
  })
})
