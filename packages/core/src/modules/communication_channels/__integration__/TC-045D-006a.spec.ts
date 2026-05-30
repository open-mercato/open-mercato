import { expect, test } from '@playwright/test'

/**
 * TC-045D-006a — Reassignment command + PUT route contract.
 *
 * Slice 2f adds:
 *   - `communication_channels.conversation.reassign` command registered at boot.
 *   - `PUT /api/communication_channels/threads/[threadId]/assign` gated by
 *     `communication_channels.assign`.
 */
test.describe('TC-045D-006a: reassign-conversation contract', () => {
  test('command is registered with a stable id + execute', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/commands/reassign-conversation'
    )
    expect(mod.COMMUNICATION_CHANNELS_REASSIGN_CONVERSATION_COMMAND_ID).toBe(
      'communication_channels.conversation.reassign',
    )
    expect(mod.default).toBeDefined()
    expect(mod.default.id).toBe('communication_channels.conversation.reassign')
    expect(typeof mod.default.execute).toBe('function')
  })
})
