"use client"
import { useState, useRef, useEffect } from 'react'
import type { OperationProgressEvent } from '@open-mercato/shared/modules/widgets/injection-progress'
import type { AppEventPayload } from '@open-mercato/shared/modules/widgets/injection'
import { useAppEvent } from './useAppEvent'

type ProgressStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'

interface OperationProgressState {
  status: ProgressStatus
  progress: number
  processedCount: number
  totalCount: number
  currentStep?: string
  errors: number
  startedAt?: number
  elapsedMs: number
}

const IDLE_STATE: OperationProgressState = {
  status: 'idle',
  progress: 0,
  processedCount: 0,
  totalCount: 0,
  errors: 0,
  elapsedMs: 0,
}

/**
 * React hook that tracks long-running operation progress via the DOM Event Bridge.
 *
 * Listens for progress events matching the given pattern and aggregates state.
 * When `operationId` is provided, only events for that specific operation are tracked.
 *
 * @param operationPattern - Event pattern to listen for (e.g., 'integration.sync.progress')
 * @param operationId - Optional filter for a specific operation instance
 *
 * @example
 * const progress = useOperationProgress('integration.sync.progress', syncRunId)
 * if (progress.status === 'running') {
 *   return <ProgressBar value={progress.progress} />
 * }
 */
export function useOperationProgress(
  operationPattern: string,
  operationId?: string,
): OperationProgressState {
  const [state, setState] = useState<OperationProgressState>(IDLE_STATE)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  useAppEvent(
    operationPattern,
    (event: AppEventPayload) => {
      const payload = event.payload as unknown as OperationProgressEvent
      if (!payload || typeof payload.status !== 'string') return
      if (operationId && payload.operationId !== operationId) return

      startedAtRef.current = payload.startedAt

      const newState: OperationProgressState = {
        status: payload.status,
        progress: payload.progress,
        processedCount: payload.processedCount,
        totalCount: payload.totalCount,
        currentStep: payload.currentStep,
        errors: payload.errors,
        startedAt: payload.startedAt,
        elapsedMs: payload.startedAt ? Date.now() - payload.startedAt : 0,
      }

      setState(newState)

      // Start elapsed time ticker when running
      if (payload.status === 'running' && !timerRef.current) {
        timerRef.current = setInterval(() => {
          if (startedAtRef.current) {
            setState((prev) => ({
              ...prev,
              elapsedMs: Date.now() - startedAtRef.current!,
            }))
          }
        }, 1000)
      }

      // Clear ticker when operation ends
      if (payload.status !== 'running' && timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    },
    [operationId],
  )

  return state
}
