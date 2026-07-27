"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { mapAgent } from './types'
import type { AgentIconName } from '../data/agentIcons'

export type AgentIconInfo = { icon: AgentIconName | null; resultKind: 'informative' | 'actionable' }

/**
 * Loads the agent registry once and exposes a `agentId → { icon, resultKind }`
 * map, so run/proposal/process-backed surfaces (caseload, processes, traces,
 * audit, playground) can render the tenant's configured agent icon instead of
 * initials. The registry list already carries the merged per-tenant `icon`
 * (GET /api/agent_orchestrator/agents), so this is a single cheap round-trip.
 *
 * Best-effort: on failure the map stays empty and callers fall back to the
 * type glyph / initials, so a registry hiccup never blanks a list.
 */
export function useAgentIconMap(): Map<string, AgentIconInfo> {
  const [map, setMap] = React.useState<Map<string, AgentIconInfo>>(new Map())
  React.useEffect(() => {
    let cancelled = false
    apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/agents',
      undefined,
      { fallback: { items: [] } },
    ).then((call) => {
      if (cancelled || !call.ok || !Array.isArray(call.result?.items)) return
      const next = new Map<string, AgentIconInfo>()
      for (const item of call.result.items) {
        const agent = mapAgent(item)
        if (agent) next.set(agent.id, { icon: agent.icon, resultKind: agent.resultKind })
      }
      setMap(next)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return map
}
