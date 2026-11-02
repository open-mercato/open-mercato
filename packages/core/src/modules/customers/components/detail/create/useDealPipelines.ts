"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type PipelineOption = {
  id: string
  name: string
  isDefault: boolean
}

export type PipelineStageOption = {
  id: string
  label: string
  order: number
}

export type UseDealPipelinesResult = {
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
  loadStages: (pipelineId: string) => Promise<void>
}

export function useDealPipelines(): UseDealPipelinesResult {
  const [pipelines, setPipelines] = React.useState<PipelineOption[]>([])
  const [stages, setStages] = React.useState<PipelineStageOption[]>([])
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const call = await apiCall<{ items: PipelineOption[] }>('/api/customers/pipelines')
        if (cancelled || !mountedRef.current) return
        if (call.ok && call.result?.items) {
          setPipelines(call.result.items)
        }
      } catch {
        if (!cancelled && mountedRef.current) setPipelines([])
      }
    })().catch(() => {
      // The inner try/catch already resets pipelines on failure; this guards the IIFE promise only.
    })
    return () => {
      cancelled = true
    }
  }, [])

  const latestStagesRequest = React.useRef(0)

  const loadStages = React.useCallback(async (pipelineId: string) => {
    const requestId = ++latestStagesRequest.current
    const isCurrent = () => mountedRef.current && requestId === latestStagesRequest.current
    // Cleared up front: stages of the previous pipeline must never be offered, or preselected,
    // for the newly chosen one while its own stages load.
    if (mountedRef.current) setStages([])
    if (!pipelineId) return
    try {
      const call = await apiCall<{ items: PipelineStageOption[] }>(
        `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`,
      )
      if (!isCurrent()) return
      if (call.ok && call.result?.items) {
        const sorted = [...call.result.items].sort((a, b) => a.order - b.order)
        setStages(sorted)
      } else {
        setStages([])
      }
    } catch {
      if (isCurrent()) setStages([])
    }
  }, [])

  return { pipelines, stages, loadStages }
}

export default useDealPipelines
