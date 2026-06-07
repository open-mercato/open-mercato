import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus, registerCommand, unregisterCommand } from '@open-mercato/shared/lib/commands'

type ActionLogServiceMock = {
  findByUndoToken: jest.Mock
  claimForUndo: jest.Mock
  releaseUndoClaim: jest.Mock
  markUndone: jest.Mock
}

function buildContainer(service: ActionLogServiceMock) {
  const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
  container.register({
    actionLogService: asValue(service),
    dataEngine: asValue({ flushOrmEntityChanges: jest.fn(async () => undefined) }),
  })
  return container
}

function buildLogStub() {
  return {
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
    relatedResourceKind: null,
    relatedResourceId: null,
    commandPayload: { id: 'person-1' },
    snapshotBefore: { id: 'person-1', lastName: 'Before' },
    snapshotAfter: { id: 'person-1', lastName: 'After' },
    changesJson: null,
  }
}

const ctx = {
  container: null as unknown,
  auth: { sub: 'user-2', tenantId: 'tenant-1', orgId: 'org-1' },
  organizationScope: null,
  selectedOrganizationId: 'org-1',
  organizationIds: null,
}

describe('CommandBus.undo TOCTOU race guard', () => {
  afterEach(() => {
    unregisterCommand('customers.people.update')
  })

  it('claims the row atomically before invoking the undo handler', async () => {
    const callOrder: string[] = []
    const undoMock = jest.fn(async () => {
      callOrder.push('undo')
    })
    registerCommand({ id: 'customers.people.update', execute: jest.fn(), undo: undoMock })

    const service: ActionLogServiceMock = {
      findByUndoToken: jest.fn(async () => buildLogStub()),
      claimForUndo: jest.fn(async () => {
        callOrder.push('claim')
        return true
      }),
      releaseUndoClaim: jest.fn(async () => true),
      markUndone: jest.fn(async () => null),
    }

    const bus = new CommandBus()
    await bus.undo('undo-token', { ...ctx, container: buildContainer(service) } as never)

    expect(service.claimForUndo).toHaveBeenCalledWith('log-1')
    expect(undoMock).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['claim', 'undo'])
    expect(service.markUndone).toHaveBeenCalledTimes(1)
    expect(service.releaseUndoClaim).not.toHaveBeenCalled()
  })

  it('does not run the undo handler when the claim is lost to a concurrent request', async () => {
    const undoMock = jest.fn(async () => {})
    registerCommand({ id: 'customers.people.update', execute: jest.fn(), undo: undoMock })

    const service: ActionLogServiceMock = {
      findByUndoToken: jest.fn(async () => buildLogStub()),
      claimForUndo: jest.fn(async () => false),
      releaseUndoClaim: jest.fn(async () => true),
      markUndone: jest.fn(async () => null),
    }

    const bus = new CommandBus()
    await expect(
      bus.undo('undo-token', { ...ctx, container: buildContainer(service) } as never),
    ).rejects.toThrow('Undo token already consumed')

    expect(undoMock).not.toHaveBeenCalled()
    expect(service.markUndone).not.toHaveBeenCalled()
  })

  it('releases the claim when the undo handler fails so the action stays retryable', async () => {
    const undoMock = jest.fn(async () => {
      throw new Error('handler boom')
    })
    registerCommand({ id: 'customers.people.update', execute: jest.fn(), undo: undoMock })

    const service: ActionLogServiceMock = {
      findByUndoToken: jest.fn(async () => buildLogStub()),
      claimForUndo: jest.fn(async () => true),
      releaseUndoClaim: jest.fn(async () => true),
      markUndone: jest.fn(async () => null),
    }

    const bus = new CommandBus()
    await expect(
      bus.undo('undo-token', { ...ctx, container: buildContainer(service) } as never),
    ).rejects.toThrow('handler boom')

    expect(service.markUndone).not.toHaveBeenCalled()
    expect(service.releaseUndoClaim).toHaveBeenCalledWith('log-1')
  })
})
