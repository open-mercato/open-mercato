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

const ORG = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'

function loadCommand(id: string): { execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> } {
  let command: unknown
  jest.isolateModules(() => {
    require('../currencies')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === id)?.[0]
  })
  if (!command) throw new Error(`command ${id} not registered`)
  return command as { execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> }
}

type FlushBehavior = 'ok' | 'reject'

function buildEm(opts: { existingRecord?: Record<string, unknown> | null; flush?: FlushBehavior } = {}) {
  const calls: string[] = []
  const em: Record<string, unknown> = {
    findOne: jest.fn().mockImplementation(async () => {
      calls.push('findOne')
      return opts.existingRecord ?? null
    }),
    create: jest.fn().mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      id: '11111111-1111-4111-8111-111111111111',
      ...payload,
    })),
    persist: jest.fn().mockImplementation(() => {
      calls.push('persist')
    }),
    nativeUpdate: jest.fn().mockImplementation(async () => {
      calls.push('nativeUpdate')
      return 1
    }),
    flush: jest.fn().mockImplementation(async () => {
      calls.push('flush')
      if (opts.flush === 'reject') throw new Error('boom')
    }),
    begin: jest.fn().mockImplementation(async () => {
      calls.push('begin')
    }),
    commit: jest.fn().mockImplementation(async () => {
      calls.push('commit')
    }),
    rollback: jest.fn().mockImplementation(async () => {
      calls.push('rollback')
    }),
  }
  ;(em as Record<string, unknown>).fork = jest.fn().mockReturnValue(em)
  ;(em as Record<string, unknown>).__calls = calls
  return em
}

function buildCtx(em: Record<string, unknown>) {
  const dataEngine = { markOrmEntityChange: jest.fn(), emitEvent: jest.fn() }
  return {
    ctx: {
      container: {
        resolve: jest.fn((token: string) => {
          if (token === 'em') return em
          if (token === 'dataEngine') return dataEngine
          return undefined
        }),
      },
      auth: { sub: 'user-1', tenantId: TENANT, orgId: ORG },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    },
    dataEngine,
  }
}

const baseCreateInput = {
  organizationId: ORG,
  tenantId: TENANT,
  code: 'USD',
  name: 'US Dollar',
  isBase: true,
}

describe('currencies.currencies.create atomicity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('demotes the prior base currency and persists the new record inside one transaction', async () => {
    const command = loadCommand('currencies.currencies.create')
    const em = buildEm({ flush: 'ok' })
    const { ctx, dataEngine } = buildCtx(em)

    await command.execute({ ...baseCreateInput }, ctx)

    const calls = (em as Record<string, unknown>).__calls as string[]
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    // Base-currency demotion must run inside the transaction, before commit.
    expect(calls.indexOf('begin')).toBeLessThan(calls.indexOf('nativeUpdate'))
    expect(calls.indexOf('nativeUpdate')).toBeLessThan(calls.indexOf('commit'))
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalled()
  })

  it('rolls back and emits no side effects when the flush fails', async () => {
    const command = loadCommand('currencies.currencies.create')
    const em = buildEm({ flush: 'reject' })
    const { ctx, dataEngine } = buildCtx(em)

    await expect(command.execute({ ...baseCreateInput }, ctx)).rejects.toThrow('boom')

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })
})
