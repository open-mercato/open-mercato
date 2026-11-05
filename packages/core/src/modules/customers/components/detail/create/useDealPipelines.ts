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

  const loadStages = React.useCallback(async (pipelineId: string) => {
    if (!pipelineId) {
      if (mountedRef.current) setStages([])
      return
    }
    try {
      const call = await apiCall<{ items: PipelineStageOption[] }>(
        `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`,
      )
      if (!mountedRef.current) return
      if (call.ok && call.result?.items) {
        const sorted = [...call.result.items].sort((a, b) => a.order - b.order)
        setStages(sorted)
      } else {
        setStages([])
      }
    } catch {
      if (mountedRef.current) setStages([])
    }
  }, [])

  return { pipelines, stages, loadStages }
}

export default useDealPipelines
