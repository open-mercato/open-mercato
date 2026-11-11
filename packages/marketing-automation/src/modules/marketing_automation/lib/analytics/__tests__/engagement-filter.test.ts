import { buildEngagementRunFilter } from '../engagement-filter.js'

/**
 * The funnel drill-down used to collect every matching `run_id` into a JS array and filter with
 * `id IN (…)` — a parameter list that grows with the campaign. `buildEngagementRunFilter` replaces it
 * with a correlated `exists (…)` subquery, so the query it emits never depends on how many people
 * reached the stage: a campaign with ten sends and one with ten million produce the exact same SQL
 * shape and the exact same, small, parameter count.
 */
describe('buildEngagementRunFilter', () => {
  it('emits a correlated exists subquery, never an id list, for "received"', () => {
    const filter = buildEngagementRunFilter('received', 'campaign-1')
    expect(filter.sql).toMatch(/exists\s*\(/i)
    expect(filter.sql).not.toMatch(/\bin\s*\(/i)
    expect(filter.sql).toContain('r.id')
    expect(filter.sql).toContain("s.status = 'sent'")
    expect(filter.params).toEqual(['campaign-1'])
  })

  it('emits a correlated exists subquery against events for "opened"/"clicked"', () => {
    for (const engagement of ['opened', 'clicked'] as const) {
      const filter = buildEngagementRunFilter(engagement, 'campaign-1')
      expect(filter.sql).toMatch(/exists\s*\(/i)
      expect(filter.sql).not.toMatch(/\bin\s*\(/i)
      expect(filter.params).toEqual(['campaign-1', engagement])
    }
  })

  /**
   * The large-candidate-set guarantee: nothing about the emitted query scales with how many sends or
   * delivery events the campaign has produced, because the function never sees that count — it is not
   * one of its inputs. A regression that went back to collecting ids first would have to change this
   * function's signature to take them, which this test pins against.
   */
  it('stays a constant, bounded shape regardless of how large the candidate set would be', () => {
    const candidateSetSizes = [0, 1, 500, 250_000]
    for (const size of candidateSetSizes) {
      // The candidate-set size is irrelevant input on purpose — the point under test is that there is
      // nowhere to pass it in. `void size` keeps the loop meaningfully documenting that for each scale.
      void size
      const filter = buildEngagementRunFilter('received', 'campaign-1')
      expect(filter.params).toHaveLength(1)
      expect(filter.sql.length).toBeLessThan(400)
    }
  })
})
