'use client'

import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type AgentsResponse = { items?: Array<{ id?: unknown; label?: unknown }> }

const EMPTY_LABELS: ReadonlyMap<string, string> = new Map()

/**
 * Agent id → author-facing label, for the run views' reason line.
 *
 * "Use the agent's label, never its definition key" is an existing rule in this
 * module, and the label lives in the OPTIONAL `agent_orchestrator` peer's
 * registry — the same endpoint `AgentSelector` and `AgentInvokeConfigField`
 * read. When the peer is not installed the route 404s and this stays empty, so
 * the caller falls back to the id rather than to an invented name.
 *
 * `enabled` is the caller's answer to "does this run contain an agent step at
 * all"; a run without one must not pay for the request.
 */
export function useAgentLabels(enabled: boolean): ReadonlyMap<string, string> {
  const { data } = useQuery({
    queryKey: ['workflow-agent-labels'],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const result = await apiCall<AgentsResponse>('/api/agent_orchestrator/agents', undefined, {
        fallback: { items: [] },
      })
      const labels = new Map<string, string>()
      for (const item of result.result?.items ?? []) {
        if (typeof item?.id !== 'string' || item.id.length === 0) continue
        if (typeof item.label !== 'string' || item.label.length === 0) continue
        labels.set(item.id, item.label)
      }
      return labels as ReadonlyMap<string, string>
    },
  })

  return data ?? EMPTY_LABELS
}
