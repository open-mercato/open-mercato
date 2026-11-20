import { readTracesUrlFilters } from '../components/tracesUrlFilters'

describe('readTracesUrlFilters', () => {
  it('reads the facet and agent the review notification links to', () => {
    const params = new URLSearchParams({ agent: 'support.policy_research', facet: 'needs-review' })
    expect(readTracesUrlFilters(params)).toEqual({ facet: 'needs-review', agent: 'support.policy_research' })
  })

  it('ignores unknown facets, blank or oversized agents, and missing params', () => {
    expect(readTracesUrlFilters(new URLSearchParams({ facet: 'everything', agent: '  ' }))).toEqual({ facet: null, agent: null })
    expect(readTracesUrlFilters(new URLSearchParams({ agent: 'x'.repeat(201) }))).toEqual({ facet: null, agent: null })
    expect(readTracesUrlFilters(null)).toEqual({ facet: null, agent: null })
  })
})
