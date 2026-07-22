"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { mapAgent } from './types'

/**
 * Loads the agent registry once and exposes an `agentId → label` map, so
 * surfaces that store only the definition id (eval cases, eval runs, traces)
 * can show the agent's human name instead of its key.
 *
 * Best-effort by design: an agent whose id has no registry entry — deleted,
 * renamed, or provided by a module that is no longer installed — keeps
 * rendering its id, which is why callers must always pass a fallback rather
 * than treat a miss as an error.
 */
export function useAgentLabelMap(): Map<string, string> {
  const [map, setMap] = React.useState<Map<string, string>>(new Map())
  React.useEffect(() => {
    let cancelled = false
    apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/agents',
      undefined,
      { fallback: { items: [] } },
    ).then((call) => {
      if (cancelled || !call.ok || !Array.isArray(call.result?.items)) return
      const next = new Map<string, string>()
      for (const item of call.result.items) {
        const agent = mapAgent(item)
        if (agent && agent.label) next.set(agent.id, agent.label)
      }
      setMap(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return map
}

/** The registry label for an agent id, falling back to the id itself. */
export function agentLabelFor(labels: Map<string, string>, agentId: string): string {
  return labels.get(agentId) || agentId
}
