"use client"

import * as React from 'react'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type PipelineOption = {
  id: string
  name: string
  isDefault: boolean
  stageProbabilitiesEnabled?: boolean
}

export type PipelineStageOption = {
  id: string
  label: string
  order: number
  defaultProbability?: number | null
}

export type UseDealPipelinesResult = {
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
  /** The pipeline `stages` were loaded for; `null` while none are loaded. */
  stagesPipelineId: string | null
  /** True from the moment a pipeline's stages are requested until the latest request settles. */
  stagesLoading: boolean
  /** The latest request failed, which is not the same as a pipeline with no stages. */
  stagesFailed: boolean
  retryStages: () => void
  loadStages: (pipelineId: string) => Promise<void>
}

export function useDealPipelines(): UseDealPipelinesResult {
  const [pipelines, setPipelines] = React.useState<PipelineOption[]>([])
  const [loadedStages, setLoadedStages] = React.useState<{
    pipelineId: string | null
    stages: PipelineStageOption[]
  }>({ pipelineId: null, stages: [] })
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

  const [stagesLoading, setStagesLoading] = React.useState(false)
  const [stagesFailed, setStagesFailed] = React.useState(false)
  const latestStagesRequest = React.useRef(0)
  const requestedPipelineId = React.useRef('')

  const loadStages = React.useCallback(async (pipelineId: string) => {
    const requestId = ++latestStagesRequest.current
    requestedPipelineId.current = pipelineId
    const isCurrent = () => mountedRef.current && requestId === latestStagesRequest.current
    // Cleared up front: stages of the previous pipeline must never be offered, or preselected,
    // for the newly chosen one while its own stages load.
    if (mountedRef.current) {
      setLoadedStages({ pipelineId: null, stages: [] })
      setStagesLoading(Boolean(pipelineId))
      setStagesFailed(false)
    }
    if (!pipelineId) return
    try {
      const call = await apiCall<{ items: PipelineStageOption[] }>(
        `/api/customers/pipeline-stages?pipelineId=${encodeURIComponent(pipelineId)}`,
      )
      if (!isCurrent()) return
      if (call.ok && call.result?.items) {
        const sorted = [...call.result.items].sort((a, b) => a.order - b.order)
        setLoadedStages({ pipelineId, stages: sorted })
      } else {
        setStagesFailed(true)
      }
    } catch (error) {
      getTelemetryRuntime()?.reportError(error, {
        module: 'customers',
        code: 'customers.deal_pipeline_stages_load_failed',
        attributes: { pipelineId },
      })
      if (isCurrent()) setStagesFailed(true)
    } finally {
      if (isCurrent()) setStagesLoading(false)
    }
  }, [])

  const retryStages = React.useCallback(() => {
    void loadStages(requestedPipelineId.current)
  }, [loadStages])

  return {
    pipelines,
    stages: loadedStages.stages,
    stagesPipelineId: loadedStages.pipelineId,
    stagesLoading,
    stagesFailed,
    retryStages,
    loadStages,
  }
}

export default useDealPipelines
