export type TracesFacetKey = 'all' | 'errors' | 'needs-review'

export type TracesUrlFilters = {
  facet: TracesFacetKey | null
  agent: string | null
}

const FACETS: readonly TracesFacetKey[] = ['all', 'errors', 'needs-review']
const MAX_AGENT_ID_LENGTH = 200

/**
 * Deep-link filters for the Traces list (`?facet=needs-review&agent=<id>`), used
 * by the review-requested notification. Unknown facets and oversized agent ids
 * are ignored; the agent id is only ever sent back as a list filter.
 */
export function readTracesUrlFilters(params: { get(name: string): string | null } | null | undefined): TracesUrlFilters {
  const rawFacet = params?.get('facet') ?? null
  const facet = rawFacet && (FACETS as readonly string[]).includes(rawFacet) ? (rawFacet as TracesFacetKey) : null
  const rawAgent = params?.get('agent')?.trim() ?? ''
  const agent = rawAgent.length > 0 && rawAgent.length <= MAX_AGENT_ID_LENGTH ? rawAgent : null
  return { facet, agent }
}
