import { expect, test } from '@playwright/test'

/**
 * TC-045D-003b — Outbound subscriber + worker module surface contract.
 *
 * Slice 2c verifies the published module surface that provider packages and
 * downstream apps will rely on:
 *   - The subscriber registers itself on `messages.message.sent` with a stable id.
 *   - The worker exports the canonical queue name + concurrency.
 *   - The retry-policy max-attempts constant is exposed for provider integration tests.
 */
test.describe('TC-045D-003b: outbound subscriber + worker contract', () => {
  test('subscriber declares correct event + persistent + id metadata', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/subscribers/outbound-bridge'
    )
    expect(mod.metadata.event).toBe('messages.message.sent')
    expect(mod.metadata.persistent).toBe(true)
    expect(mod.metadata.id).toBe('communication_channels:outbound-bridge')
    expect(typeof mod.default).toBe('function')
  })

  test('worker exports canonical queue name + concurrency + max-attempts', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/workers/outbound-delivery'
    )
    expect(mod.metadata.queue).toBe('communication-channels-outbound')
    expect(mod.metadata.id).toBe('communication_channels:outbound-delivery')
    expect(mod.metadata.concurrency).toBe(10)
    expect(mod.OUTBOUND_DELIVERY_MAX_ATTEMPTS).toBe(3)
    expect(typeof mod.default).toBe('function')
  })
})
