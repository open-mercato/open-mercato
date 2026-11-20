import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { CommandBus, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { getTransactionLifetime } from '@open-mercato/shared/lib/commands/transaction-lifetime'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Todo } from '../../data/entities'
import '../todos'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

const id = '11111111-1111-4111-8111-111111111111'
const tenantId = '22222222-2222-4222-8222-222222222222'
const organizationId = '33333333-3333-4333-8333-333333333333'
const scope = { tenantId, organizationId }
const currentVersion = new Date('2000-11-19T10:00:00Z')

function setup(custom: Record<string, unknown> = {}) {
  const row = Object.assign(new Todo(), {
    id, ...scope, title: 'Original', notes: 'Scoped note', updatedAt: currentVersion, deletedAt: null,
  })
  let state = { row: row as Todo | null, custom, logCount: 0 }
  let before: typeof state | undefined
  const chronology: string[] = []
  const actions: string[] = []
  const active = jest.fn(() => before !== undefined)
  const nativeUpdate = jest.fn(async (_entity, _where, patch) => {
    state.row = Object.assign(new Todo(), state.row, patch)
    chronology.push('write')
    return 1
  })
  const em = {
    isInTransaction: active, nativeUpdate,
    fork: jest.fn(() => { throw new Error('writes may not fork') }),
    async begin() { before = structuredClone(state); chronology.push('begin') },
    async flush() {},
    async commit() { before = undefined; chronology.push('commit') },
    async rollback() {
      if (before) state = before
      before = undefined
      chronology.push('rollback')
    },
  } as unknown as EntityManager
  jest.mocked(findOneWithDecryption).mockImplementation(async (manager, _entity, where, options) => {
    expect(manager).toBe(em)
    expect(where).toMatchObject({ id, tenantId, organizationId })
    if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) chronology.push('lock')
    return state.row as never
  })
  jest.mocked(loadCustomFieldSnapshot).mockImplementation(async (manager) => {
    expect(manager).toBe(em)
    chronology.push('snapshot')
    return structuredClone(state.custom)
  })
  const scopedEngine = {
    setCustomFields: jest.fn(async ({ values }) => {
      chronology.push('custom')
      state.custom = { ...state.custom, ...values }
    }),
    markOrmEntityChange: jest.fn(({ action }) => { actions.push(action) }),
    flushOrmEntityChanges: jest.fn(),
    deleteOrmEntity: jest.fn(async () => {
      const value = state.row
      state.row = null
      chronology.push('write')
      return value
    }),
  }
  const engine = {
    createCommandTransactionScope: jest.fn(() => ({
      dataEngine: scopedEngine,
      async complete(outcome: string) {
        expect(active()).toBe(false)
        if (outcome === 'committed') chronology.push(...actions)
        actions.length = 0
      },
    })),
  }
  const log = jest.fn(async (_data, manager) => {
    expect(manager).toBe(em)
    expect(active()).toBe(true)
    chronology.push('log')
    state.logCount++
    return { resourceId: id, id: 'log-entry' }
  })
  const container = createContainer()
  container.register({ em: asValue({}), dataEngine: asValue(engine), actionLogService: asValue({ log }) })
  const context = () => ({
    container,
    auth: { tenantId, orgId: organizationId, sub: 'test-user' },
    organizationScope: null,
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    transactionalEm: em,
    transactionLifetime: getTransactionLifetime(em),
    crudFormSectionTargetVersionRequired: true,
    beforeTransactionalWrite: async (manager: EntityManager, input: unknown) => {
      expect(manager).toBe(em)
      expect(active()).toBe(true)
      expect(input).toMatchObject({ id })
      chronology.push('final-input')
    },
  }) as CommandRuntimeContext
  return { bus: new CommandBus(), em, chronology, context, nativeUpdate, setCustomFields: scopedEngine.setCustomFields, state: () => state }
}

describe('configured Todo transaction', () => {
  it('keeps the locked host version and audit snapshots when a sink-only save echoes the host and custom values', async () => {
    const { bus, em, context, nativeUpdate, setCustomFields, chronology, state } = setup({ priority: 2, severity: 'medium' })
    await withAtomicFlush(em, [async () => {
      const result = await bus.execute('example.todos.update', {
        input: {
          id, title: 'Original', is_done: false, notes: 'Scoped note', expected_updated_at: currentVersion.toISOString(),
          customFields: { priority: 2, severity: 'medium', season: null },
        },
        ctx: context(),
      })
      expect(result.ambient?.tentativeResult).toMatchObject({ id, updatedAt: currentVersion })
      expect(chronology).not.toContain('updated')
    }], { transaction: true })
    expect(nativeUpdate).not.toHaveBeenCalled()
    expect(setCustomFields).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ row: { updatedAt: currentVersion }, custom: { priority: 2, severity: 'medium' }, logCount: 1 })
    expect(chronology.indexOf('updated')).toBeGreaterThan(chronology.indexOf('commit'))
  })

  it('advances the host version when a submitted custom field actually clears a stored value', async () => {
    const { bus, em, context, nativeUpdate, setCustomFields, state } = setup({ priority: 2, season: 'winter' })
    await withAtomicFlush(em, [async () => {
      await bus.execute('example.todos.update', {
        input: { id, expected_updated_at: currentVersion.toISOString(), customFields: { priority: 2, season: null } },
        ctx: context(),
      })
    }], { transaction: true })
    expect(nativeUpdate).toHaveBeenCalledWith(Todo, { id, ...scope, deletedAt: null }, { updatedAt: expect.any(Date) })
    expect(setCustomFields).toHaveBeenCalledWith(expect.objectContaining({ values: { season: null } }))
    expect(state().row?.updatedAt.getTime()).toBeGreaterThan(currentVersion.getTime())
  })

  it.each(['off', 'catalog.product'])('enforces the configured version outside the legacy allowlist (%s)', async (envValue) => {
    const original = process.env.OM_OPTIMISTIC_LOCK
    process.env.OM_OPTIMISTIC_LOCK = envValue
    try {
      for (const operation of ['update', 'delete'] as const) {
        const { bus, em, context, nativeUpdate, setCustomFields, state } = setup()
        const body = { id, expected_updated_at: '2000-11-18T10:00:00.000Z' }
        const input = operation === 'update' ? body : { body, query: { id } }
        await expect(withAtomicFlush(em, [async () => {
          await bus.execute(`example.todos.${operation}`, { input, ctx: context() })
        }], { transaction: true })).rejects.toMatchObject({
          status: 409, body: { code: 'optimistic_lock_conflict', expectedUpdatedAt: body.expected_updated_at },
        })
        expect(nativeUpdate).not.toHaveBeenCalled()
        expect(setCustomFields).not.toHaveBeenCalled()
        expect(state()).toMatchObject({ row: { updatedAt: currentVersion }, logCount: 0 })
      }
    } finally {
      if (original === undefined) delete process.env.OM_OPTIMISTIC_LOCK
      else process.env.OM_OPTIMISTIC_LOCK = original
    }
  })

  it('binds final input and snapshots to the lock, advances a custom-only version, and rolls back logs and effects', async () => {
    const { bus, em, context, nativeUpdate, chronology, state } = setup()
    const input = { id, expected_updated_at: currentVersion.toISOString(), customFields: { priority: 4 } }
    await expect(withAtomicFlush(em, [async () => {
      const result = await bus.execute('example.todos.update', { input, ctx: context() })
      expect(result.ambient?.tentativeResult).toMatchObject({ id })
      expect(state().custom).toEqual({ priority: 4 })
      expect(state().row?.updatedAt.getTime()).toBeGreaterThan(currentVersion.getTime())
      expect(state().logCount).toBe(1)
      expect(chronology).not.toContain('updated')
      throw new Error('local sink failure')
    }], { transaction: true })).rejects.toThrow('local sink failure')
    expect(nativeUpdate).toHaveBeenCalledWith(Todo, { id, ...scope, deletedAt: null }, { updatedAt: expect.any(Date) })
    expect(chronology).toEqual(expect.arrayContaining(['lock', 'final-input', 'snapshot', 'write', 'custom', 'log', 'rollback']))
    expect(chronology.indexOf('lock')).toBeLessThan(chronology.indexOf('final-input'))
    expect(chronology.indexOf('final-input')).toBeLessThan(chronology.indexOf('write'))
    expect(state()).toMatchObject({ row: { title: 'Original', updatedAt: currentVersion }, custom: {}, logCount: 0 })
    expect(chronology).not.toContain('updated')
  })

  it.each(['update', 'delete'] as const)('refuses a stale %s before domain writes or snapshots', async (operation) => {
    const { bus, em, context, nativeUpdate, chronology, state } = setup()
    const body = { id, expected_updated_at: '2000-11-18T10:00:00.000Z' }
    const input = operation === 'update' ? body : { body, query: { id } }
    await expect(withAtomicFlush(em, [async () => {
      await bus.execute(`example.todos.${operation}`, { input, ctx: context() })
    }], { transaction: true })).rejects.toMatchObject({ status: 409 })
    expect(chronology).toEqual(['begin', 'lock', 'rollback'])
    expect(nativeUpdate).not.toHaveBeenCalled()
    expect(state()).toMatchObject({ row: { title: 'Original' }, logCount: 0 })
  })

  it('commits host, custom fields and log together before publishing deferred effects', async () => {
    const { bus, em, context, chronology, state } = setup()
    await withAtomicFlush(em, [async () => {
      await bus.execute('example.todos.update', {
        input: { id, title: 'Edited', customFields: { priority: 4 } },
        ctx: context(),
      })
    }], { transaction: true })
    expect(state()).toMatchObject({ row: { title: 'Edited' }, custom: { priority: 4 }, logCount: 1 })
    expect(chronology.indexOf('updated')).toBeGreaterThan(chronology.indexOf('commit'))
  })
})
