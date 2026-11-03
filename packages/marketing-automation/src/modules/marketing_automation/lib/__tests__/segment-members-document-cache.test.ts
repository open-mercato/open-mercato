import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { SubjectDocument } from '../engine/types'

const buildSubjectDocument = jest.fn()
jest.mock('../subject-document.js', () => ({
  buildSubjectDocument: (...args: unknown[]) => buildSubjectDocument(...args),
}))
jest.mock('../tiers.js', () => ({ loadTierThresholds: async () => [] }))
jest.mock('../value-boundaries.js', () => ({ loadValueBoundaries: async () => null }))

import { resolveSegmentMembers } from '../segment-members'

const scope = { tenantId: 't1', organizationId: 'o1' }

/** Two live people and nothing else; the expression below never narrows, so both are walked. */
const em = {
  find: async () => [{ id: 'p1' }, { id: 'p2' }],
  getConnection: () => ({ execute: async () => [] }),
} as unknown as EntityManager

const container = {} as AwilixContainer

const documentFor = (id: string): SubjectDocument => ({
  customer: { id, email: `${id}@example.com`, displayName: id, createdAt: null, locale: 'pl' },
  tags: ['vip'],
  orders: { count: 0, totalGross: 0, skus: [], categories: [], channels: [] },
  rfm: null,
  value: null,
  score: { points: 0, tier: null, tierRank: -1 },
  address: null,
  survey: { nps: null, answeredAt: null },
  engagement: { sent: 0, opened: 0, clicked: 0 },
  segments: [],
  trigger: {},
})

/**
 * An expression the SQL narrowing cannot answer, so every candidate has to be described. That is the only
 * case the cache exists for.
 *
 * Language, deliberately: `tags CONTAINS` has a candidate source and narrows, which is exactly why the first
 * version of this test saw zero documents built and proved nothing. There is no candidate source for a
 * locale, so the resolver has to walk the population and describe each person.
 */
const expression = { operator: 'AND' as const, rules: [{ field: 'customer.locale', operator: '=', value: 'pl' }] }

describe('the shared document cache', () => {
  beforeEach(() => {
    buildSubjectDocument.mockReset()
    buildSubjectDocument.mockImplementation(async (_em: unknown, id: string) => documentFor(id))
  })

  it('describes each customer once across several resolutions', async () => {
    const documents = new Map<string, SubjectDocument>()
    const options = { maxChecked: 10, documents }

    await resolveSegmentMembers(em, container, scope, expression, options)
    expect(buildSubjectDocument).toHaveBeenCalledTimes(2)

    // The second segment walks the same population on the same tick. Describing those two people again is
    // twenty-two queries for an answer already in hand.
    await resolveSegmentMembers(em, container, scope, expression, options)
    expect(buildSubjectDocument).toHaveBeenCalledTimes(2)
  })

  it('describes them again when no cache is supplied', async () => {
    // The lifetime belongs to the caller: a lone resolution has nothing to share, and a cache that outlived
    // one pass would answer a later tick with a customer as they were.
    await resolveSegmentMembers(em, container, scope, expression, { maxChecked: 10 })
    await resolveSegmentMembers(em, container, scope, expression, { maxChecked: 10 })
    expect(buildSubjectDocument).toHaveBeenCalledTimes(4)
  })

  it('still returns the members, cached or not', async () => {
    const documents = new Map<string, SubjectDocument>()
    const first = await resolveSegmentMembers(em, container, scope, expression, { maxChecked: 10, documents })
    const second = await resolveSegmentMembers(em, container, scope, expression, { maxChecked: 10, documents })
    expect(first.ids).toEqual(['p1', 'p2'])
    expect(second.ids).toEqual(first.ids)
  })
})
