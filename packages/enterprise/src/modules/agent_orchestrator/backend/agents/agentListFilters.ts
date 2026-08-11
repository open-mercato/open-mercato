import { normalizeAgentTag } from '../../data/agentTags'
import type { AgentRuntime } from '../../components/types'

/**
 * Filtering for the agents registry list.
 *
 * `GET /api/agent_orchestrator/agents` returns the whole registry in one
 * response (it is a code/file-authored list, not a paged table), and the page
 * already slices it for pagination — so matching happens here, in memory, rather
 * than as query params the endpoint does not have.
 *
 * Semantics: values inside one facet are OR-ed, facets are AND-ed together. Tags
 * follow the same rule (an agent matching ANY selected tag is kept), so picking
 * a second tag widens the result set exactly like picking a second runtime does.
 */

export type AgentFilterableRow = {
  id: string
  label: string
  description: string
  resultKind: 'researcher' | 'proposal'
  runtime: AgentRuntime
  autonomy: string
  status: string
  tags: string[]
}

export type AgentListFilterValues = {
  resultKind?: string[]
  runtime?: string[]
  autonomy?: string[]
  status?: string[]
  tags?: string[]
}

export const AGENT_LIST_FILTER_IDS = ['resultKind', 'runtime', 'autonomy', 'status', 'tags'] as const

function selected(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

/** Free-text match over the id, label, description and tags. */
export function matchesAgentSearch(row: AgentFilterableRow, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return (
    row.id.toLowerCase().includes(needle) ||
    row.label.toLowerCase().includes(needle) ||
    row.description.toLowerCase().includes(needle) ||
    row.tags.some((tag) => tag.includes(needle))
  )
}

export function matchesAgentFilters(row: AgentFilterableRow, values: AgentListFilterValues): boolean {
  const kinds = selected(values.resultKind)
  if (kinds.length && !kinds.includes(row.resultKind)) return false
  const runtimes = selected(values.runtime)
  if (runtimes.length && !runtimes.includes(row.runtime)) return false
  const autonomies = selected(values.autonomy)
  if (autonomies.length && !autonomies.includes(row.autonomy)) return false
  const statuses = selected(values.status)
  if (statuses.length && !statuses.includes(row.status)) return false
  const tags = selected(values.tags).map(normalizeAgentTag)
  if (tags.length && !tags.some((tag) => row.tags.includes(tag))) return false
  return true
}

export function filterAgentRows<T extends AgentFilterableRow>(
  rows: T[],
  search: string,
  values: AgentListFilterValues,
): T[] {
  return rows.filter((row) => matchesAgentSearch(row, search) && matchesAgentFilters(row, values))
}

/** Every tag in use across the loaded registry, sorted, for the filter's option list. */
export function collectAgentTagOptions(rows: AgentFilterableRow[]): string[] {
  const tags = new Set<string>()
  for (const row of rows) for (const tag of row.tags) tags.add(tag)
  return Array.from(tags).sort((a, b) => a.localeCompare(b))
}
