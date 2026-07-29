'use client'

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
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
}

type InstancesResponse = { data: InstanceSummary[] }
type StepsResponse = { data: RunStepInstanceInput[] }
type EventsResponse = { data: RunEventInput[] }

export type LastRunOverlay = {
  instance: InstanceSummary | null
  execution: RunExecution | null
  isLoading: boolean
  isUnavailable: boolean
}

const EMPTY_OVERLAY: LastRunOverlay = {
  instance: null,
  execution: null,
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

  const execution = React.useMemo(() => {
    if (!active || !instanceQuery.data) return null
    return deriveRunExecution({
      events: eventsQuery.data ?? [],
      stepInstances: stepsQuery.data ?? [],
      currentStepId: instanceQuery.data.currentStepId,
      instanceStatus: instanceQuery.data.status,
    })
  }, [active, instanceQuery.data, eventsQuery.data, stepsQuery.data])

  if (!active) return EMPTY_OVERLAY

  return {
    instance: instanceQuery.data ?? null,
    execution,
    isLoading: instanceQuery.isLoading || stepsQuery.isLoading || eventsQuery.isLoading,
    // A definition that has never run is not an error — the toggle says so
    // instead of painting an empty overlay that reads like "nothing executed".
    isUnavailable: !instanceQuery.isLoading && !instanceQuery.data,
  }
}
