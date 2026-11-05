import { expect, test } from '@playwright/test'

/**
 * TC-045D-003a — `communication_channels.message.deliver_outbound` command is
 * registered with the command bus at module load time.
 *
 * Slice 2c: the outbound bridge depends on this command. The command is registered
 * via side-effect import from `index.ts` so that any DI consumer can resolve it.
 * Schema validation rejects malformed input synchronously.
 */
test.describe('TC-045D-003a: deliver_outbound_message command registration', () => {
  test('command exports a stable id and execute function', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/commands/deliver-outbound-message'
    )
    expect(mod.COMMUNICATION_CHANNELS_DELIVER_OUTBOUND_COMMAND_ID).toBe(
      'communication_channels.message.deliver_outbound',
    )
    expect(mod.default).toBeDefined()
    expect(mod.default.id).toBe('communication_channels.message.deliver_outbound')
    expect(typeof mod.default.execute).toBe('function')
  })

  test('command schema rejects malformed messageId', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/commands/deliver-outbound-message'
    )
    await expect(
      mod.default.execute(
        { messageId: 'not-a-uuid', scope: { tenantId: '11111111-1111-1111-1111-111111111111', organizationId: null } } as never,
        {
          container: { resolve: () => null } as any,
          auth: null,
          organizationScope: null,
          selectedOrganizationId: null,
          organizationIds: null,
        },
      ),
    ).rejects.toBeTruthy()
  })
})
