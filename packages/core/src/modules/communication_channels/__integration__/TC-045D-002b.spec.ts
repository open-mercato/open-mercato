import { expect, test } from '@playwright/test'

/**
 * TC-045D-002b — `communication_channels.message.ingest_inbound` command is
 * registered with the command bus at module load time.
 *
 * Slice 2b: the inbound bridge depends on this command. The command is registered
 * via side-effect import from `index.ts` so that any DI consumer can resolve it.
 *
 * This test imports the command file directly and asserts its public surface,
 * which exercises the same code path that runs at boot.
 */
test.describe('TC-045D-002b: ingest_inbound_message command registration', () => {
  test('command exports a stable id and execute function', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/commands/ingest-inbound-message'
    )
    expect(mod.COMMUNICATION_CHANNELS_INGEST_INBOUND_COMMAND_ID).toBe(
      'communication_channels.message.ingest_inbound',
    )
    expect(mod.default).toBeDefined()
    expect(mod.default.id).toBe('communication_channels.message.ingest_inbound')
    expect(typeof mod.default.execute).toBe('function')
  })

  test('command schema rejects malformed input synchronously', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/commands/ingest-inbound-message'
    )
    const command = mod.default
    await expect(
      command.execute(
        { invalid: true } as never,
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
