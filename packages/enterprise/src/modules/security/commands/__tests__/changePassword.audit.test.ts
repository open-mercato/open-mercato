import { asValue, createContainer, InjectionMode } from 'awilix'
import { CommandBus, unregisterCommand } from '@open-mercato/shared/lib/commands'
import { commandId } from '../changePassword'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

describe('security.password.change audit persistence', () => {
  afterAll(() => {
    unregisterCommand(commandId)
  })

  it('records the action without current or new password data', async () => {
    const log = jest.fn(async (payload: Record<string, unknown>) => payload)
    const changePassword = jest.fn(async () => undefined)
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      actionLogService: asValue({ log }),
      dataEngine: asValue({ flushOrmEntityChanges: jest.fn() }),
      passwordService: asValue({ changePassword }),
    })
    const bus = new CommandBus()
    const ctx = {
      container,
      auth: { sub: 'user-1', tenantId: 'tenant-1', orgId: 'org-1' },
      organizationScope: null,
      selectedOrganizationId: 'org-1',
      organizationIds: ['org-1'],
    }

    await bus.execute(commandId, {
      input: {
        currentPassword: 'CurrentPass1!',
        newPassword: 'NewPassword2!',
      },
      ctx,
    })

    expect(changePassword).toHaveBeenCalledWith('user-1', 'CurrentPass1!', 'NewPassword2!')
    expect(log).toHaveBeenCalledTimes(1)
    const persisted = log.mock.calls[0][0]
    expect(persisted.undoToken).toBeUndefined()
    expect(persisted.commandPayload).toEqual({
      hasCurrentPassword: '[REDACTED]',
      __redoUnavailable: 'sensitive-data-redacted',
    })
    expect(JSON.stringify(persisted)).not.toContain('CurrentPass1!')
    expect(JSON.stringify(persisted)).not.toContain('NewPassword2!')
  })
})
