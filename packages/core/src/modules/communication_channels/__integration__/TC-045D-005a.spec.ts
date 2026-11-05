import { expect, test } from '@playwright/test'

/**
 * TC-045D-005a — Enrichers module surface contract.
 *
 * The hub exports 2 enrichers for `messages.message`. Hosts (Messages CRUD route +
 * future provider routes) opt in via `makeCrudRoute({ enrichers: { entityId: 'messages.message' } })`.
 * This test verifies the public export shape so downstream provider packages can
 * rely on it.
 *
 * The channel/payload/contact enrichments are produced by a single batched
 * `communication_channels.message-channel` enricher (#3183) — collapsing the three
 * previously separate enrichers so the shared `MessageChannelLink` batch is loaded
 * once per pass. The public enriched field names (`_channel`, `_channelPayload`,
 * `_channelContact`, `_reactions`) are unchanged.
 */
test.describe('TC-045D-005a: enrichers module contract', () => {
  test('exports an array of 2 enrichers all targeting messages.message', async () => {
    const mod = await import(
      '@open-mercato/core/modules/communication_channels/data/enrichers'
    )
    expect(Array.isArray(mod.enrichers)).toBe(true)
    expect(mod.enrichers).toHaveLength(2)
    const ids = mod.enrichers.map((e) => e.id).sort()
    expect(ids).toEqual([
      'communication_channels.message-channel',
      'communication_channels.message-reactions',
    ])
    for (const enricher of mod.enrichers) {
      expect(enricher.targetEntity).toBe('messages.message')
      expect(enricher.features).toEqual(['communication_channels.view'])
      expect(typeof enricher.enrichMany).toBe('function')
    }
  })
})
