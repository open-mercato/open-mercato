'use client'

import { useEffect, useState } from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { AgentListItem } from './AgentSelector'

/**
 * Agent ids the registry reports as answering OUT OF BAND, for the Studio's
 * parallel-branch authoring check (`lib/parallel-branch-agent-warnings.ts`).
 *
 * `runtime` is the registry's own vocabulary and `/api/agent_orchestrator/agents`
 * has always served it (`AgentListItem.runtime`) — the Studio already renders it
 * as a badge in the agent picker. `'external'` is the runtime whose runner hands
 * the work to a third party and returns a SUSPENDED marker, so it is the one
 * that cannot land inside a parallel branch.
 *
 * `null` means "the catalogue could not be read" and is deliberately distinct
 * from an empty set: agent_orchestrator is an OPTIONAL peer, so the endpoint
 * 404s on a deployment without it, and the check must then report nothing rather
 * than treat every agent as unknown-therefore-suspect.
 */
type AgentsResponse = { items?: AgentListItem[] }

export function useOutOfBandAgentIds(enabled: boolean): ReadonlySet<string> | null {
  const [agentIds, setAgentIds] = useState<ReadonlySet<string> | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiCall<AgentsResponse>('/api/agent_orchestrator/agents', undefined, { fallback: { items: [] } })
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setAgentIds(null)
          return
        }
        const items = Array.isArray(res.result?.items) ? res.result.items : []
        const resolved = new Set<string>()
        for (const item of items) {
          if (typeof item?.id !== 'string' || item.id.length === 0) continue
          if (item.runtime !== 'external') continue
          resolved.add(item.id)
        }
        setAgentIds(resolved)
      })
      .catch(() => {
        if (!cancelled) setAgentIds(null)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return agentIds
}
