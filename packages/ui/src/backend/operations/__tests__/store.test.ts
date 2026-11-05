/**
 * @jest-environment jsdom
 */

import {
  coalesceLastOperations,
  dismissOperation,
  markUndoSuccess,
  pushOperation,
  clearAllOperations,
  operationStackConstants,
} from '../store'

function makeMeta(id: string, undoToken: string, commandId = 'customers.companies.delete') {
  return {
    id,
    undoToken,
    commandId,
    actionLabel: 'Delete company',
    resourceKind: 'customers.company',
    resourceId: id,
    executedAt: new Date().toISOString(),
  }
}

describe('operations store — bulk coalesce', () => {
  beforeEach(() => {
    clearAllOperations()
  })

  it('replaces the last N entries with a single synthetic bulk entry', () => {
    pushOperation(makeMeta('op-1', 'tk-1'))
    pushOperation(makeMeta('op-2', 'tk-2'))
    pushOperation(makeMeta('op-3', 'tk-3'))

    coalesceLastOperations(3, {
      commandId: 'customers.companies.delete',
      actionLabel: 'Delete 3 companies',
    })

    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(1)
    const synthetic = state.stack[0]
    expect(synthetic.bulkUndoTokens).toEqual(['tk-1', 'tk-2', 'tk-3'])
    expect(synthetic.bulkCount).toBe(3)
    expect(synthetic.actionLabel).toBe('Delete 3 companies')
  })

  it('is a no-op when count is 1 or less', () => {
    pushOperation(makeMeta('op-1', 'tk-1'))
    coalesceLastOperations(1, { commandId: 'customers.companies.delete' })
    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0].bulkUndoTokens).toBeUndefined()
  })

  it('refuses to coalesce when commandIds in the tail do not match', () => {
    pushOperation(makeMeta('op-1', 'tk-1', 'customers.companies.delete'))
    pushOperation(makeMeta('op-2', 'tk-2', 'customers.people.delete'))

    coalesceLastOperations(2, { commandId: 'customers.companies.delete' })
    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(2)
    expect(state.stack[1].bulkUndoTokens).toBeUndefined()
  })

  it('preserves earlier entries that fall outside the coalesce window', () => {
    pushOperation(makeMeta('earlier', 'tk-earlier', 'customers.deals.update'))
    pushOperation(makeMeta('op-1', 'tk-1'))
    pushOperation(makeMeta('op-2', 'tk-2'))

    coalesceLastOperations(2, {
      commandId: 'customers.companies.delete',
      actionLabel: 'Delete 2 companies',
    })

    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(2)
    expect(state.stack[0].id).toBe('earlier')
    expect(state.stack[1].bulkCount).toBe(2)
  })
})

describe('markUndoSuccess — bulk-aware', () => {
  beforeEach(() => {
    clearAllOperations()
  })

  it('removes a bulk entry when ALL of its bulkUndoTokens match', () => {
    pushOperation(makeMeta('op-1', 'tk-1'))
    pushOperation(makeMeta('op-2', 'tk-2'))
    coalesceLastOperations(2, {
      commandId: 'customers.companies.delete',
      actionLabel: 'Delete 2 companies',
    })

    markUndoSuccess(['tk-1', 'tk-2'])
    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(0)
    expect(state.undone).toHaveLength(1)
    expect(state.undone[0].bulkUndoTokens).toEqual(['tk-1', 'tk-2'])
  })

  it('splits a bulk entry on partial undo, keeping the unconsumed tokens on the stack', () => {
    pushOperation(makeMeta('op-1', 'tk-1'))
    pushOperation(makeMeta('op-2', 'tk-2'))
    pushOperation(makeMeta('op-3', 'tk-3'))
    coalesceLastOperations(3, {
      commandId: 'customers.companies.delete',
      actionLabel: 'Delete 3 companies',
    })

    markUndoSuccess(['tk-2', 'tk-3'])
    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0].bulkUndoTokens).toEqual(['tk-1'])
    expect(state.stack[0].bulkCount).toBe(1)
    expect(state.undone).toHaveLength(1)
    expect(state.undone[0].bulkUndoTokens).toEqual(['tk-2', 'tk-3'])
    expect(state.undone[0].bulkCount).toBe(2)
  })

  it('coalesce assigns a synthetic id distinct from the source operations', () => {
    pushOperation(makeMeta('op-1', 'tk-1'))
    pushOperation(makeMeta('op-2', 'tk-2'))
    coalesceLastOperations(2, {
      commandId: 'customers.companies.delete',
      actionLabel: 'Delete 2 companies',
    })

    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack[0].id).not.toBe('op-1')
    expect(state.stack[0].id).not.toBe('op-2')
    expect(state.stack[0].id).toMatch(/^bulk:/)
    expect(state.stack[0].undoToken).toMatch(/^bulk:/)
  })

  it('accepts a single string for legacy callers', () => {
    pushOperation(makeMeta('op-solo', 'tk-solo'))
    markUndoSuccess('tk-solo')
    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(0)
  })
})

describe('dismissOperation — auto-dismiss without redo pollution', () => {
  beforeEach(() => {
    clearAllOperations()
  })

  it('removes a single entry from the stack without adding it to the undone list', () => {
    pushOperation(makeMeta('op-1', 'tk-1'))
    pushOperation(makeMeta('op-2', 'tk-2'))

    dismissOperation('tk-2')

    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0].undoToken).toBe('tk-1')
    expect(state.undone).toHaveLength(0)
  })

  it('removes a bulk entry from the stack when ALL of its bulkUndoTokens are dismissed', () => {
    pushOperation(makeMeta('op-1', 'tk-1'))
    pushOperation(makeMeta('op-2', 'tk-2'))
    coalesceLastOperations(2, {
      commandId: 'customers.companies.delete',
      actionLabel: 'Delete 2 companies',
    })

    const before = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    const bulkToken = before.stack[0].undoToken as string

    dismissOperation(bulkToken)

    const after = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(after.stack.find((entry: { undoToken: string }) => entry.undoToken === bulkToken)).toBeUndefined()
    expect(after.undone).toHaveLength(0)
  })

  it('splits a bulk entry on partial dismissal without populating undone', () => {
    pushOperation(makeMeta('op-1', 'tk-1'))
    pushOperation(makeMeta('op-2', 'tk-2'))
    pushOperation(makeMeta('op-3', 'tk-3'))
    coalesceLastOperations(3, {
      commandId: 'customers.companies.delete',
      actionLabel: 'Delete 3 companies',
    })

    dismissOperation(['tk-2', 'tk-3'])

    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0].bulkUndoTokens).toEqual(['tk-1'])
    expect(state.stack[0].bulkCount).toBe(1)
    expect(state.undone).toHaveLength(0)
  })

  it('is a no-op when the token does not match any entry', () => {
    pushOperation(makeMeta('op-1', 'tk-1'))

    dismissOperation('tk-missing')

    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(1)
    expect(state.stack[0].undoToken).toBe('tk-1')
    expect(state.undone).toHaveLength(0)
  })

  it('exports the auto-dismiss timeout via operationStackConstants', () => {
    expect(operationStackConstants.LAST_OPERATION_AUTO_DISMISS_MS).toBeGreaterThan(0)
    expect(operationStackConstants.LAST_OPERATION_AUTO_DISMISS_MS)
      .toBeLessThan(operationStackConstants.LAST_OPERATION_TTL_MS)
  })
})

describe('LAST_OPERATION_AUTO_DISMISS_MS — env override (NEXT_PUBLIC_OM_UNDO_BANNER_TIMEOUT_MS)', () => {
  const originalValue = process.env.NEXT_PUBLIC_OM_UNDO_BANNER_TIMEOUT_MS

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.NEXT_PUBLIC_OM_UNDO_BANNER_TIMEOUT_MS
    } else {
      process.env.NEXT_PUBLIC_OM_UNDO_BANNER_TIMEOUT_MS = originalValue
    }
    jest.resetModules()
  })

  function loadStoreWithEnv(envValue: string | undefined): typeof import('../store') {
    if (envValue === undefined) {
      delete process.env.NEXT_PUBLIC_OM_UNDO_BANNER_TIMEOUT_MS
    } else {
      process.env.NEXT_PUBLIC_OM_UNDO_BANNER_TIMEOUT_MS = envValue
    }
    let mod: typeof import('../store') | undefined
    jest.isolateModules(() => {
      mod = jest.requireActual('../store')
    })
    if (!mod) throw new Error('failed to load store module')
    return mod
  }

  it('defaults to 10_000 ms when the env var is unset', () => {
    const mod = loadStoreWithEnv(undefined)
    expect(mod.operationStackConstants.LAST_OPERATION_AUTO_DISMISS_MS).toBe(10_000)
  })

  it('defaults to 10_000 ms when the env var is an empty string', () => {
    const mod = loadStoreWithEnv('')
    expect(mod.operationStackConstants.LAST_OPERATION_AUTO_DISMISS_MS).toBe(10_000)
  })

  it('uses the configured env value when it is a positive integer', () => {
    const mod = loadStoreWithEnv('20000')
    expect(mod.operationStackConstants.LAST_OPERATION_AUTO_DISMISS_MS).toBe(20_000)
  })

  it('floors a positive non-integer to an integer ms value', () => {
    const mod = loadStoreWithEnv('7500.9')
    expect(mod.operationStackConstants.LAST_OPERATION_AUTO_DISMISS_MS).toBe(7_500)
  })

  it('falls back to the default when the env value is non-numeric', () => {
    const mod = loadStoreWithEnv('not-a-number')
    expect(mod.operationStackConstants.LAST_OPERATION_AUTO_DISMISS_MS).toBe(10_000)
  })

  it('falls back to the default when the env value is zero', () => {
    const mod = loadStoreWithEnv('0')
    expect(mod.operationStackConstants.LAST_OPERATION_AUTO_DISMISS_MS).toBe(10_000)
  })

  it('falls back to the default when the env value is negative', () => {
    const mod = loadStoreWithEnv('-1000')
    expect(mod.operationStackConstants.LAST_OPERATION_AUTO_DISMISS_MS).toBe(10_000)
  })
})
