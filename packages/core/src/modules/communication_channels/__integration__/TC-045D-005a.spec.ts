import { expect, test } from '@playwright/test'

/**
 * TC-045D-005a — Enrichers module surface contract.
 *
 * Slice 2e exports 4 enrichers for `messages.message`. Hosts (Messages CRUD route +
 * future provider routes) opt in via `makeCrudRoute({ enrichers: { entityId: 'messages.message' } })`.
 * This test verifies the public export shape so downstream provider packages can
 * rely on it.
 */
test.describe('TC-045D-005a: enrichers module contract', () => {
  test('exports an array of 4 enrichers all targeting messages.message', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/data/enrichers'
    )
    expect(Array.isArray(mod.enrichers)).toBe(true)
    expect(mod.enrichers).toHaveLength(4)
    const ids = mod.enrichers.map((e) => e.id).sort()
    expect(ids).toEqual([
      'communication_channels.conversation-contact',
      'communication_channels.message-channel',
      'communication_channels.message-channel-payload',
      'communication_channels.message-reactions',
    ])
    for (const enricher of mod.enrichers) {
      expect(enricher.targetEntity).toBe('messages.message')
      expect(enricher.features).toEqual(['communication_channels.view'])
      expect(typeof enricher.enrichMany).toBe('function')
    }
  })
})
