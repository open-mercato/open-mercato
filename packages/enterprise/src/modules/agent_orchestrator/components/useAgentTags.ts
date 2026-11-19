"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { mapAgent } from './types'

/**
 * Every tag already in use across the registry, sorted.
 *
 * Feeds the tag editor's suggestion list so an operator picks `billing` again
 * instead of typing `billings` — near-duplicate tags are what make a tag filter
 * useless. Best-effort: a failed read just means no suggestions, never an error,
 * because custom values stay allowed regardless.
 */
export function useAgentTagSuggestions(): string[] {
  const [tags, setTags] = React.useState<string[]>([])
  React.useEffect(() => {
    let cancelled = false
    apiCall<{ items?: Array<Record<string, unknown>> }>(
      '/api/agent_orchestrator/agents',
      undefined,
      { fallback: { items: [] } },
    ).then((call) => {
      if (cancelled || !call.ok || !Array.isArray(call.result?.items)) return
      const seen = new Set<string>()
      for (const item of call.result.items) {
        const agent = mapAgent(item)
        if (!agent) continue
        for (const tag of agent.tags) seen.add(tag)
      }
      setTags(Array.from(seen).sort((a, b) => a.localeCompare(b)))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return tags
}
