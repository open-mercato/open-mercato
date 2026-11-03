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

/**
 * How much of a population the manager holds while a bulk action resolves it.
 *
 * Each subject document loads the customer, their profile, their addresses and their tags, decrypted. Without
 * clearing as it walks, resolving a segment of fifty thousand people held all of them until the job finished —
 * the same defect the sweep already carries a rule about, in the one other place that walks a population.
 */
const population = Array.from({ length: 1_200 }, (_, index) => ({ id: `p${index}` }))

const documentFor = (id: string): SubjectDocument => ({
  customer: { id, email: `${id}@example.com`, displayName: id, createdAt: null, locale: 'pl' },
  tags: [],
  orders: { count: 0, totalGross: 0, skus: [], categories: [], channels: [] },
  rfm: null,
  value: null,
  score: { points: 0, tier: null, tierRank: -1 },
  address: null,
  engagement: { sent: 0, opened: 0, clicked: 0, daysSinceEngaged: null },
  survey: null,
  segments: [],
  consent: null,
  preference: null,
} as unknown as SubjectDocument)

// No candidate source answers a locale, so the resolver has to walk the population and describe each person.
const expression = { operator: 'AND' as const, rules: [{ field: 'customer.locale', operator: '=', value: 'pl' }] }

describe('resolveSegmentMembers — the identity map', () => {
  let clears = 0
  let em: EntityManager

  beforeEach(() => {
    clears = 0
    buildSubjectDocument.mockReset()
    buildSubjectDocument.mockImplementation(async (_em: unknown, id: string) => documentFor(id))
    em = {
      find: async () => population,
      getConnection: () => ({ execute: async () => [] }),
      clear: () => { clears += 1 },
    } as unknown as EntityManager
  })

  it('empties the manager as it walks a large population', async () => {
    await resolveSegmentMembers(em, {} as AwilixContainer, scope, expression, { maxChecked: 1_200 })
    expect(buildSubjectDocument).toHaveBeenCalledTimes(1_200)
    // Every 500: twice over 1,200, and never at position zero.
    expect(clears).toBe(2)
  })

  it('does not bother for a population small enough to hold', async () => {
    em = {
      find: async () => population.slice(0, 10),
      getConnection: () => ({ execute: async () => [] }),
      clear: () => { clears += 1 },
    } as unknown as EntityManager
    await resolveSegmentMembers(em, {} as AwilixContainer, scope, expression, { maxChecked: 10 })
    expect(clears).toBe(0)
  })
})
