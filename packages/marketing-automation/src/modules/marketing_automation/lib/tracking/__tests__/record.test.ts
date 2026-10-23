import { recordTrackingEvent } from '../record'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { TrackingClaims } from '../token'

/**
 * What a public, unauthenticated tracking request is allowed to write.
 *
 * Two properties, and the second exists because a tracking token deliberately never expires — it has to survive
 * in a mail archive — so anybody holding one link can replay it forever.
 */
const claims: TrackingClaims = {
  tenantId: 't1',
  organizationId: 'o1',
  campaignId: 'camp-1',
  runId: 'run-1',
  stepId: 'step-1',
  purpose: 'open',
}

function fakeEm(existing: Record<string, unknown> | null = null) {
  const created: Record<string, unknown>[] = []
  const queries: Array<Record<string, unknown>> = []
  const em = {
    findOne: async (_entity: unknown, where: Record<string, unknown>) => {
      queries.push(where)
      // The send lookup answers null; the "already opened" lookup answers whatever the test set up.
      return where.type === 'opened' ? existing : null
    },
    create: (_entity: unknown, data: Record<string, unknown>) => {
      const row = { ...data }
      created.push(row)
      return row
    },
    persist: () => {},
    flush: async () => {},
  }
  return { em: em as unknown as EntityManager, created, queries }
}

describe('recordTrackingEvent', () => {
  test('writes the scope from the TOKEN, never from the request', async () => {
    const { em, created } = fakeEm()
    await recordTrackingEvent(em, claims, { type: 'opened', now: new Date() })
    // An unauthenticated caller has no scope of its own; everything here is signed.
    expect(created[0]).toMatchObject({ tenantId: 't1', organizationId: 'o1', campaignId: 'camp-1', runId: 'run-1' })
  })

  /**
   * The regression: a pixel fetched in a loop was a row per fetch, in a table nothing prunes. The metrics were
   * already immune because they count distinct runs — which is exactly why the growth was invisible.
   */
  test('a second open of the same message is not recorded again', async () => {
    const { em, created } = fakeEm({ id: 'already-there' })
    await recordTrackingEvent(em, claims, { type: 'opened', now: new Date() })
    expect(created).toEqual([])
  })

  test('a second CLICK is recorded, because it is a fact about behaviour', async () => {
    const { em, created } = fakeEm({ id: 'an-open-exists' })
    await recordTrackingEvent(em, { ...claims, purpose: 'click' }, {
      type: 'clicked',
      linkUrl: 'https://shop.example/boots',
      now: new Date(),
    })
    expect(created).toHaveLength(1)
    expect(created[0].linkUrl).toBe('https://shop.example/boots')
  })

  test('a long link is truncated rather than refused', async () => {
    const { em, created } = fakeEm()
    await recordTrackingEvent(em, { ...claims, purpose: 'click' }, {
      type: 'clicked',
      linkUrl: `https://shop.example/${'x'.repeat(5000)}`,
      now: new Date(),
    })
    // The column is for attribution, not archival: losing the event would understate the campaign.
    expect(String(created[0].linkUrl).length).toBeLessThanOrEqual(2000)
  })
})
