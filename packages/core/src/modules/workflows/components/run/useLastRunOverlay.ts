'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAgentLabels } from './useAgentLabels'
import {
  deriveRunExecution,
  type RunExecution,
  type RunEventInput,
  type RunStepInstanceInput,
} from '../../lib/run-execution'

type InstanceSummary = {
  id: string
  workflowId: string
  status: string
  currentStepId: string | null
  startedAt: string
  completedAt: string | null
  /** Engine-owned markers; only `attention` is read here. */
  metadata?: { attention?: unknown } | null
}

type InstancesResponse = { data: InstanceSummary[] }
type StepsResponse = { data: RunStepInstanceInput[] }
type EventsResponse = { data: RunEventInput[] }

export type LastRunOverlay = {
  instance: InstanceSummary | null
  execution: RunExecution | null
  /**
   * Agent id → label for the reason line. Travels WITH the overlay so the
   * Studio canvas names an agent exactly the way the run detail page does.
   */
  agentLabels: ReadonlyMap<string, string>
  isLoading: boolean
  isUnavailable: boolean
}

const EMPTY_AGENT_LABELS: ReadonlyMap<string, string> = new Map()

const EMPTY_OVERLAY: LastRunOverlay = {
  instance: null,
  execution: null,
  agentLabels: EMPTY_AGENT_LABELS,
  isLoading: false,
  isUnavailable: false,
}

/**
 * "Show last run" for the Studio canvas (spec §8.3).
 *
 * Reads the most recent instance of the definition being edited and derives the
 * SAME `RunExecution` the run detail page paints from, so the two surfaces can
 * never disagree about what a run did.
 *
 * Nothing here is fetched unless the toggle is on: an author editing a
 * definition should not pay for three requests they never asked for.
 */
export function useLastRunOverlay(options: {
  workflowId?: string | null
  enabled: boolean
}): LastRunOverlay {
  const { workflowId, enabled } = options
  const active = enabled && !!workflowId

  const instanceQuery = useQuery({
    queryKey: ['workflow-last-run', workflowId],
    enabled: active,
    queryFn: async () => {
      const params = new URLSearchParams({ workflowId: workflowId!, limit: '1' })
      const result = await apiCall<InstancesResponse>(`/api/workflows/instances?${params.toString()}`)
      if (!result.ok) throw new Error('[internal] Failed to load the last workflow run')
      return result.result?.data?.[0] ?? null
    },
  })

  const instanceId = instanceQuery.data?.id ?? null

  const stepsQuery = useQuery({
    queryKey: ['workflow-last-run-steps', instanceId],
    enabled: active && !!instanceId,
    queryFn: async () => {
      const result = await apiCall<StepsResponse>(
        `/api/workflows/instances/${instanceId}/steps?limit=100`
      )
      if (!result.ok) throw new Error('[internal] Failed to load the last run step executions')
      return result.result?.data ?? []
    },
  })

  // Events carry the TAKEN PATH — a transition leaves no row of its own, so the
  // route overlay has no other source.
  const eventsQuery = useQuery({
    queryKey: ['workflow-last-run-events', instanceId],
    enabled: active && !!instanceId,
    queryFn: async () => {
      const result = await apiCall<EventsResponse>(
        `/api/workflows/instances/${instanceId}/events?eventType=TRANSITION_EXECUTED&limit=100`
      )
      if (!result.ok) throw new Error('[internal] Failed to load the last run transitions')
      return result.result?.data ?? []
    },
  })

  // The park events (spec Part 2) come from a SECOND, unfiltered page rather
  // than by widening the query above: the list route's `eventType` filter is a
  // single equality, and dropping it would let a long run's transitions fall off
  // the same 100-row page the taken path depends on. Two cheap reads, both only
  // once the toggle is on.
  const parkEventsQuery = useQuery({
    queryKey: ['workflow-last-run-park-events', instanceId],
    enabled: active && !!instanceId,
    queryFn: async () => {
      const result = await apiCall<EventsResponse>(
        `/api/workflows/instances/${instanceId}/events?limit=100`
      )
      if (!result.ok) throw new Error('[internal] Failed to load the last run events')
      return result.result?.data ?? []
    },
  })

  // Only worth a request once there is a run to overlay at all.
  const agentLabels = useAgentLabels(active && !!instanceId)

  const execution = React.useMemo(() => {
    if (!active || !instanceQuery.data) return null
    return deriveRunExecution({
      events: [...(eventsQuery.data ?? []), ...(parkEventsQuery.data ?? [])],
      stepInstances: stepsQuery.data ?? [],
      currentStepId: instanceQuery.data.currentStepId,
      instanceStatus: instanceQuery.data.status,
      attention: instanceQuery.data.metadata?.attention,
    })
  }, [active, instanceQuery.data, eventsQuery.data, parkEventsQuery.data, stepsQuery.data])

  if (!active) return EMPTY_OVERLAY

  return {
    instance: instanceQuery.data ?? null,
    execution,
    agentLabels,
    isLoading:
      instanceQuery.isLoading || stepsQuery.isLoading || eventsQuery.isLoading || parkEventsQuery.isLoading,
    // A definition that has never run is not an error — the toggle says so
    // instead of painting an empty overlay that reads like "nothing executed".
    isUnavailable: !instanceQuery.isLoading && !instanceQuery.data,
  }
}
