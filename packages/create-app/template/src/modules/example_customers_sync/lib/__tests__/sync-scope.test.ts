const execute = jest.fn(async () => ({ interactionId: 'interaction-1' }))
const findMappingByTodoId = jest.fn()
const deleteExampleCustomerInteractionMapping = jest.fn(async () => true)

jest.mock('../toggles', () => ({
  resolveExampleCustomersSyncFlags: jest.fn(async () => ({ enabled: true, bidirectional: true })),
}))

jest.mock('../mappings', () => ({
  findMappingByTodoId: (...args: unknown[]) => findMappingByTodoId(...args),
  deleteExampleCustomerInteractionMapping: (...args: unknown[]) =>
    deleteExampleCustomerInteractionMapping(...args),
}))

jest.mock('../runtime', () => ({
  buildExampleCustomersSyncCommandContext: jest.fn(() => ({
    tenantId: 'tenant-1',
    organizationId: 'organization-1',
  })),
  EXAMPLE_CUSTOMERS_SYNC_INBOUND_ORIGIN: 'example-customers-sync-inbound',
  EXAMPLE_CUSTOMERS_SYNC_OUTBOUND_ORIGIN: 'example-customers-sync-outbound',
}))

jest.mock('../../events', () => ({
  emitExampleCustomersSyncEvent: jest.fn(async () => undefined),
}))

import { syncExampleTodoToCanonicalInteraction } from '../sync'

function makeContainer() {
  const entityManager = { fork: jest.fn(() => entityManager) }
  return {
    resolve: (name: string) => {
      if (name === 'em') return entityManager
      if (name === 'commandBus') return { execute }
      if (name === 'eventBus') return { emitEvent: jest.fn(async () => undefined) }
      throw new Error(`Unexpected container resolve: ${name}`)
    },
  }
}

describe('example customers sync worker scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects a mapping whose scope does not match the queued delete job', async () => {
    findMappingByTodoId.mockResolvedValue({
      interactionId: 'interaction-1',
      todoId: 'todo-1',
      tenantId: 'tenant-1',
      organizationId: 'foreign-organization',
    })

    await syncExampleTodoToCanonicalInteraction(makeContainer(), {
      eventId: 'example.todo.deleted',
      todoId: 'todo-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(execute).not.toHaveBeenCalled()
    expect(deleteExampleCustomerInteractionMapping).not.toHaveBeenCalled()
  })

  it('preserves valid same-scope mapped deletion', async () => {
    const mapping = {
      interactionId: 'interaction-1',
      todoId: 'todo-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    }
    findMappingByTodoId.mockResolvedValue(mapping)

    await syncExampleTodoToCanonicalInteraction(makeContainer(), {
      eventId: 'example.todo.deleted',
      todoId: 'todo-1',
      tenantId: 'tenant-1',
      organizationId: 'organization-1',
    })

    expect(execute).toHaveBeenCalledWith('customers.interactions.delete', expect.objectContaining({
      input: { body: { id: 'interaction-1' } },
    }))
    expect(deleteExampleCustomerInteractionMapping).toHaveBeenCalledWith(expect.anything(), mapping)
  })
})
