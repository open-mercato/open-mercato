import { enrichers } from '../enrichers'
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

const findEnricher = (id: string): ResponseEnricher => {
  const e = enrichers.find((x) => x.id === id)
  if (!e) throw new Error(`Enricher ${id} not found in exported array`)
  return e
}

describe('communication_channels enrichers — registration', () => {
  it('exports exactly 4 enrichers, all targeting messages.message', () => {
    expect(enrichers).toHaveLength(4)
    for (const e of enrichers) {
      expect(e.targetEntity).toBe('messages.message')
    }
  })

  it('every enricher is feature-gated by communication_channels.view', () => {
    for (const e of enrichers) {
      expect(e.features).toEqual(['communication_channels.view'])
    }
  })

  it('every enricher implements enrichMany (no N+1)', () => {
    for (const e of enrichers) {
      expect(typeof e.enrichMany).toBe('function')
    }
  })

  it('namespaces enriched fields with `_channel*` / `_reactions` prefixes (fallback shape)', () => {
    for (const e of enrichers) {
      const fallback = (e.fallback ?? {}) as Record<string, unknown>
      const keys = Object.keys(fallback)
      // Every enricher's fallback uses an underscore-prefixed key (per AGENTS.md).
      expect(keys.length).toBeGreaterThan(0)
      for (const key of keys) {
        expect(key.startsWith('_')).toBe(true)
      }
    }
  })

  it('every enricher has a stable id under the communication_channels namespace', () => {
    for (const e of enrichers) {
      expect(e.id.startsWith('communication_channels.')).toBe(true)
    }
  })
})

describe('communication_channels enrichers — short-circuit empty input', () => {
  function ctx() {
    return {
      organizationId: 'org',
      tenantId: 'tenant',
      userId: 'user',
      em: { find: jest.fn(async () => []) },
      container: { resolve: () => null },
    } as any
  }

  it('returns empty array when invoked with no records', async () => {
    for (const e of enrichers) {
      const out = await e.enrichMany!([], ctx())
      expect(out).toEqual([])
    }
  })
})

describe('messageReactionsEnricher — grouping + reactedByMe', () => {
  const enricher = findEnricher('communication_channels.message-reactions')
  const currentUserId = 'user-1'

  function ctx() {
    return {
      organizationId: 'org',
      tenantId: 'tenant',
      userId: currentUserId,
      em: {
        find: jest.fn(async (_entity: unknown) => [
          // 3× thumbsup, one of which is from current user
          { messageId: 'm1', emoji: '👍', reactedByUserId: 'user-1', reactedByExternalId: null, providerKey: 'slack', reactedByDisplayName: null },
          { messageId: 'm1', emoji: '👍', reactedByUserId: null, reactedByExternalId: 'U2', providerKey: 'slack', reactedByDisplayName: 'External 2' },
          { messageId: 'm1', emoji: '👍', reactedByUserId: 'user-3', reactedByExternalId: null, providerKey: 'slack', reactedByDisplayName: null },
          // 1× heart, not from current user
          { messageId: 'm1', emoji: '❤️', reactedByUserId: 'user-4', reactedByExternalId: null, providerKey: 'slack', reactedByDisplayName: null },
        ]),
      },
      container: { resolve: () => null },
    } as any
  }

  it('groups reactions by emoji with correct counts, reactedByMe, and descending count order', async () => {
    const out = await enricher.enrichMany!([{ id: 'm1' }] as any, ctx())
    const reactions = (out[0] as any)._reactions
    expect(reactions).toBeDefined()
    expect(reactions.length).toBe(2)
    expect(reactions[0].emoji).toBe('👍')
    expect(reactions[0].count).toBe(3)
    expect(reactions[0].reactedByMe).toBe(true)
    expect(reactions[1].emoji).toBe('❤️')
    expect(reactions[1].count).toBe(1)
    expect(reactions[1].reactedByMe).toBe(false)
  })
})

describe('messageReactionsEnricher — batched lookup (no N+1)', () => {
  const enricher = findEnricher('communication_channels.message-reactions')

  it('issues a single bounded reaction query regardless of record count', async () => {
    const find = jest.fn(async () => [])
    const ctx = {
      organizationId: 'org',
      tenantId: 'tenant',
      userId: 'user-1',
      em: { find },
      container: { resolve: () => null },
    } as any
    const records = Array.from({ length: 25 }, (_, i) => ({ id: `m-${i}` }))

    const out = await enricher.enrichMany!(records as any, ctx)

    expect(out).toHaveLength(25)
    // A per-record (N+1) implementation would hit the data source 25 times;
    // the batched enricher issues exactly one query for the whole page.
    expect(find).toHaveBeenCalledTimes(1)
  })
})
