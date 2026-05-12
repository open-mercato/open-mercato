/**
 * @jest-environment jsdom
 */

import {
  coalesceLastOperations,
  markUndoSuccess,
  pushOperation,
  clearAllOperations,
  useOperationStore,
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

function getStack() {
  return useOperationStore.bind(null) as never
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

  it('removes a bulk entry when any of its bulkUndoTokens matches', () => {
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

  it('accepts a single string for legacy callers', () => {
    pushOperation(makeMeta('op-solo', 'tk-solo'))
    markUndoSuccess('tk-solo')
    const state = JSON.parse(window.localStorage.getItem('om:last-operations:v1')!)
    expect(state.stack).toHaveLength(0)
  })
})
