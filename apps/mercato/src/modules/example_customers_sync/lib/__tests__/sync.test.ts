import {
  resolveInboundInteractionSyncStrategy,
  resolveMappingTodoIdForSyncFailure,
} from '../sync'

describe('example_customers_sync sync helpers', () => {
  it('routes inbound done transitions through the canonical complete command', () => {
    expect(
      resolveInboundInteractionSyncStrategy({
        currentStatus: 'planned',
        isDone: true,
      }),
    ).toEqual({
      updateStatusInCommand: false,
      lifecycleCommandId: 'customers.interactions.complete',
    })

    expect(
      resolveInboundInteractionSyncStrategy({
        currentStatus: 'done',
        isDone: true,
      }),
    ).toEqual({
      updateStatusInCommand: false,
      lifecycleCommandId: null,
    })

    expect(
      resolveInboundInteractionSyncStrategy({
        currentStatus: 'done',
        isDone: false,
      }),
    ).toEqual({
      updateStatusInCommand: true,
      lifecycleCommandId: null,
    })
  })

  it('uses a deterministic todo id when the first outbound sync attempt fails', () => {
    expect(
      resolveMappingTodoIdForSyncFailure({
        interactionId: 'interaction-1',
      }),
    ).toBe('interaction-1')

    expect(
      resolveMappingTodoIdForSyncFailure({
        interactionId: 'interaction-1',
        mappingTodoId: 'todo-1',
      }),
    ).toBe('todo-1')
  })
})
