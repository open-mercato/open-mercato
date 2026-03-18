import { createContainer, asValue, InjectionMode } from 'awilix'
import { registerCommand, unregisterCommand, CommandBus } from '@open-mercato/shared/lib/commands'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'

type LogRecord = {
  id: string
  commandId: string
  resourceKind: string
  resourceId: string
  tenantId: string
  organizationId: string
  commandPayload?: Record<string, unknown>
}

jest.mock('@open-mercato/shared/lib/crud/cache', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/crud/cache')
  return {
    ...actual,
    invalidateCrudCache: jest.fn(),
  }
})

describe('CommandBus cache invalidation for sales documents', () => {
  const invalidateMock = invalidateCrudCache as jest.MockedFunction<typeof invalidateCrudCache>

  afterEach(() => {
    unregisterCommand('sales.orders.update')
    invalidateMock.mockClear()
  })

  it('invalidates cache on execute (redo) and undo for sales orders update', async () => {
    const logMock = jest.fn(async () => ({ id: 'log-entry' }))
    const undoMock = jest.fn(async () => {})

    registerCommand({
      id: 'sales.orders.update',
      execute: jest.fn(async () => ({ id: 'order-1', tenantId: 'tenant-1', organizationId: 'org-1' })),
      buildLog: jest.fn(() => ({
        actionLabel: 'Update sales order',
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })),
      undo: undoMock,
    })

    const logRecord: LogRecord = {
      id: 'log-entry',
      commandId: 'sales.orders.update',
      resourceKind: 'sales.order',
      resourceId: 'order-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      commandPayload: {},
    }

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      actionLogService: asValue({
        log: logMock,
        findByUndoToken: jest.fn(async () => logRecord),
        markUndone: jest.fn(async () => {}),
      }),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn() }),
    })

    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
      organizationScope: null,
      selectedOrganizationId: 'org-1',
      organizationIds: null,
    }

    await bus.execute('sales.orders.update', { input: {}, ctx })

    expect(invalidateMock).toHaveBeenCalledWith(
      container,
      'sales.order',
      { id: 'order-1', organizationId: 'org-1', tenantId: 'tenant-1' },
      'tenant-1',
      'command:sales.orders.update:execute',
      expect.any(Array)
    )

    await bus.undo('undo-token', ctx)

    expect(undoMock).toHaveBeenCalled()
    expect(invalidateMock).toHaveBeenCalledWith(
      container,
      'sales.order',
      { id: 'order-1', organizationId: 'org-1', tenantId: 'tenant-1' },
      'tenant-1',
      'command:sales.orders.update:undo',
      expect.any(Array)
    )
  })
})
