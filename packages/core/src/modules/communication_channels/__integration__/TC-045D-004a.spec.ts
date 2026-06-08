import { expect, test } from '@playwright/test'

/**
 * TC-045D-004a — Reactions command + worker module surface contract.
 *
 * Slice 2d verifies the published surface that provider packages and downstream
 * apps rely on for reactions:
 *   - `process_inbound_reaction` command is registered with a stable id.
 *   - `toggle_outbound_reaction` command is registered with a stable id.
 *   - The reaction worker exports the canonical reactions queue + concurrency
 *     + max-attempts constant.
 */
test.describe('TC-045D-004a: reactions module contract', () => {
  test('process_inbound_reaction command exports stable id + execute', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/commands/process-inbound-reaction'
    )
    expect(mod.COMMUNICATION_CHANNELS_PROCESS_INBOUND_REACTION_COMMAND_ID).toBe(
      'communication_channels.reaction.process_inbound',
    )
    expect(mod.default).toBeDefined()
    expect(mod.default.id).toBe('communication_channels.reaction.process_inbound')
    expect(typeof mod.default.execute).toBe('function')
  })

  test('toggle_outbound_reaction command exports stable id + execute', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/commands/toggle-outbound-reaction'
    )
    expect(mod.COMMUNICATION_CHANNELS_TOGGLE_OUTBOUND_REACTION_COMMAND_ID).toBe(
      'communication_channels.reaction.toggle_outbound',
    )
    expect(mod.default).toBeDefined()
    expect(mod.default.id).toBe('communication_channels.reaction.toggle_outbound')
    expect(typeof mod.default.execute).toBe('function')
  })

  test('reaction worker exports canonical queue + concurrency + max-attempts', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/workers/reaction-processor'
    )
    expect(mod.metadata.queue).toBe('communication-channels-reactions')
    expect(mod.metadata.id).toBe('communication_channels:reaction-processor')
    expect(mod.metadata.concurrency).toBe(10)
    expect(typeof mod.default).toBe('function')

    const types = await import(
      '@open-mercato/core/modules/communication_channels/lib/reaction-processor-types'
    )
    expect(types.REACTION_PROCESSOR_MAX_ATTEMPTS).toBe(3)
  })
})
