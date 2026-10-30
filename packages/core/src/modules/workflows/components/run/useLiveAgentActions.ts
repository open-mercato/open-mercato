'use client'

import * as React from 'react'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

/**
 * Live agent-action telemetry for the run view (workflows spec Phase 2).
 *
 * Subscribes to the `workflows.agent.action` DOM-bridge event the optional
 * `agent_orchestrator` peer emits per AI-SDK step while an INVOKE_AGENT step
 * runs, and ACCUMULATES a bounded, append-only list — unlike `useLiveRunUpdates`
 * (which refetches run state), these are ephemeral telemetry rendered directly.
 * Nothing is persisted: a reopened finished run shows no history, and a browser
 * that connects late simply misses earlier actions. Steps + tool calls only —
 * no token text.
 */
export type LiveAgentAction = {
  key: string
  kind: 'tool_call' | 'step_finish' | string
  name?: string
  stepIndex: number
  toolCallCount: number
}

/** Keep the live log bounded — a long agent run must never grow memory unbounded. */
export const MAX_LIVE_AGENT_ACTIONS = 50

export type UseLiveAgentActionsOptions = {
  /** Only actions carrying this instance id are kept. */
  instanceId?: string | null
  /** Turn the subscription off (e.g. before the instance has loaded). */
  enabled?: boolean
}

export function useLiveAgentActions({
  instanceId,
  enabled = true,
}: UseLiveAgentActionsOptions): LiveAgentAction[] {
  const [actions, setActions] = React.useState<LiveAgentAction[]>([])

  useAppEvent(
    'workflows.agent.action',
    (event) => {
      if (!enabled) return
      const payload = event.payload
      if (!payload || typeof payload !== 'object') return
      const record = payload as Record<string, unknown>
      if (instanceId) {
        const payloadInstanceId = record.id ?? record.instanceId
        if (typeof payloadInstanceId !== 'string' || payloadInstanceId !== instanceId) return
      }
      const stepIndex = typeof record.stepIndex === 'number' ? record.stepIndex : 0
      const toolCallCount = typeof record.toolCallCount === 'number' ? record.toolCallCount : 0
      const kind = typeof record.kind === 'string' ? record.kind : 'step_finish'
      const name = typeof record.name === 'string' ? record.name : undefined
      setActions((prev) => {
        const next = [
          ...prev,
          { key: `${stepIndex}-${prev.length}`, kind, name, stepIndex, toolCallCount },
        ]
        return next.length > MAX_LIVE_AGENT_ACTIONS
          ? next.slice(next.length - MAX_LIVE_AGENT_ACTIONS)
          : next
      })
    },
    [enabled, instanceId]
  )

  return actions
}
