export {}

const registerCommand = jest.fn()
const setCustomFieldsIfAny = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/commands', () => ({
  registerCommand,
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/commands/helpers')
  return {
    ...actual,
    setCustomFieldsIfAny,
  }
})

const ORG = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'

function loadCommand(id: string): { execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> } {
  let command: unknown
  jest.isolateModules(() => {
    require('../categories')
    command = registerCommand.mock.calls.find(([cmd]) => cmd.id === id)?.[0]
  })
  if (!command) throw new Error(`command ${id} not registered`)
  return command as { execute: (input: Record<string, unknown>, ctx: unknown) => Promise<unknown> }
}

function buildEm(opts: { rejectFlushOnCall?: number } = {}) {
  const calls: string[] = []
  let flushCount = 0
  const em: Record<string, unknown> = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockImplementation(async () => {
      calls.push('find')
      return []
    }),
    create: jest.fn().mockImplementation((_entity: unknown, payload: Record<string, unknown>) => ({
      id: '11111111-1111-4111-8111-111111111111',
      ...payload,
    })),
    persist: jest.fn(),
    flush: jest.fn().mockImplementation(async () => {
      flushCount += 1
      calls.push('flush')
      if (opts.rejectFlushOnCall && flushCount === opts.rejectFlushOnCall) {
        throw new Error('boom')
      }
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
  const dataEngine = { markOrmEntityChange: jest.fn(), setCustomFields: jest.fn() }
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

const createInput = {
  organizationId: ORG,
  tenantId: TENANT,
  name: 'Books',
}

describe('catalog.categories.create atomicity', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  it('writes the entity and rebuilds the hierarchy inside one transaction', async () => {
    const command = loadCommand('catalog.categories.create')
    const em = buildEm()
    const { ctx, dataEngine } = buildCtx(em)

    await command.execute({ ...createInput }, ctx)

    const calls = (em as Record<string, unknown>).__calls as string[]
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(em.rollback).not.toHaveBeenCalled()
    // Hierarchy rebuild query must run inside the transaction (after begin, before commit).
    expect(calls.indexOf('begin')).toBeLessThan(calls.indexOf('find'))
    expect(calls.indexOf('find')).toBeLessThan(calls.indexOf('commit'))
    expect(dataEngine.markOrmEntityChange).toHaveBeenCalled()
  })

  it('rolls back the entity write when the hierarchy rebuild flush fails', async () => {
    const command = loadCommand('catalog.categories.create')
    // Second flush is the hierarchy rebuild flush.
    const em = buildEm({ rejectFlushOnCall: 2 })
    const { ctx, dataEngine } = buildCtx(em)

    await expect(command.execute({ ...createInput }, ctx)).rejects.toThrow('boom')

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
    expect(dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
  })
})
