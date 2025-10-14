import { createContainer, asValue, InjectionMode } from 'awilix'
import { unregisterCommand, registerCommand, CommandBus } from '@open-mercato/shared/lib/commands'

describe('CommandBus', () => {
  afterEach(() => {
    unregisterCommand('test.command')
  })

  it('executes registered command and logs action metadata', async () => {
    const logMock = jest.fn(async () => ({ id: 'log-entry' }))
    registerCommand({
      id: 'test.command',
      execute: jest.fn(async () => ({ ok: true })),
      buildLog: jest.fn(() => ({ actionLabel: 'Test', resourceKind: 'test', resourceId: '123' })),
    })

    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({ actionLogService: asValue({ log: logMock }) })

    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: null },
      organizationScope: null,
      selectedOrganizationId: null,
      organizationIds: null,
    }

    const { result, logEntry } = await bus.execute('test.command', { input: {}, ctx })

    expect(result).toEqual({ ok: true })
    expect(logMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: 'test.command',
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        resourceId: '123',
      })
    )
    expect(logEntry).toEqual({ id: 'log-entry' })
  })
})
