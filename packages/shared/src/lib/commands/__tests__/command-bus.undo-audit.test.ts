import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus, registerCommand, unregisterCommand } from '@open-mercato/shared/lib/commands'

describe('CommandBus undo audit trace', () => {
  afterEach(() => {
    unregisterCommand('customers.people.update')
  })

  it('records a reversal log payload when undo succeeds', async () => {
    const undoMock = jest.fn(async () => {})
    const markUndoneMock = jest.fn(async () => null)

    registerCommand({
      id: 'customers.people.update',
      execute: jest.fn(),
      undo: undoMock,
    })

    const originalBefore = { id: 'person-1', lastName: 'Before' }
    const originalAfter = { id: 'person-1', lastName: 'After' }

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      actionLogService: asValue({
        findByUndoToken: jest.fn(async () => ({
          id: 'log-1',
          commandId: 'customers.people.update',
          actionLabel: 'Update person',
          actorUserId: 'user-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          resourceKind: 'customers.person',
          resourceId: 'person-1',
          parentResourceKind: null,
          parentResourceId: null,
          commandPayload: { id: 'person-1' },
          snapshotBefore: originalBefore,
          snapshotAfter: originalAfter,
          changesJson: {
            lastName: { from: 'Before', to: 'After' },
          },
        })),
        markUndone: markUndoneMock,
      }),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn(async () => undefined) }),
    })

    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-2', tenantId: 'tenant-1', orgId: 'org-1' },
      organizationScope: null,
      selectedOrganizationId: 'org-1',
      organizationIds: null,
    }

    await bus.undo('undo-token', ctx)

    expect(undoMock).toHaveBeenCalledTimes(1)
    expect(markUndoneMock).toHaveBeenCalledWith('log-1', expect.objectContaining({
      commandId: 'customers.people.update',
      actionLabel: 'Update person',
      actorUserId: 'user-2',
      resourceKind: 'customers.person',
      resourceId: 'person-1',
      snapshotBefore: originalAfter,
      snapshotAfter: originalBefore,
      changes: {
        lastName: { from: 'After', to: 'Before' },
      },
      context: expect.objectContaining({
        historyAction: 'undo',
        sourceLogId: 'log-1',
        sourceCommandId: 'customers.people.update',
      }),
    }))
  })
})
