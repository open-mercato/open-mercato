"use client"

import * as React from 'react'
import { loadDictionaryEntriesByKey } from '@open-mercato/core/modules/dictionaries/lib/clientEntries'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { useCustomerDictionary } from '../../../../../components/detail/hooks/useCustomerDictionary'
import { DEAL_STATUS_DEFAULTS, ENTITY_SOURCE_DEFAULTS, PIPELINE_STAGE_DEFAULTS } from '../../../../../lib/dictionaryDefaults'
import {
  useDealPipelines,
  type PipelineOption,
  type PipelineStageOption,
} from '../../../../../components/detail/create/useDealPipelines'

export type DealMergeLossReason = { id: string; label: string }

export type DealMergeLookups = {
  pipelines: PipelineOption[]
  stages: PipelineStageOption[]
  stagesPipelineId: string | null
  stagesLoading: boolean
  loadStages: (pipelineId: string) => Promise<void>
  lossReasons: DealMergeLossReason[]
  pipelineLabel: (pipelineId: string) => string | null
  statusLabel: (status: string) => string | null
  stageLabel: (stage: string) => string | null
  sourceLabel: (source: string) => string | null
  lossReasonLabel: (lossReasonId: string) => string | null
}

type DictionaryLabelSource = Record<string, { label?: string | null } | undefined> | undefined

export function resolveDictionaryLabel(
  map: DictionaryLabelSource,
  defaults: ReadonlyArray<{ value: string; label: string }>,
  value: string,
): string | null {
  const fromDictionary = map?.[value]?.label
  if (fromDictionary) return fromDictionary
  return defaults.find((entry) => entry.value === value)?.label ?? null
}

export function useDealMergeLookups(): DealMergeLookups {
  const { pipelines, stages, stagesPipelineId, stagesLoading, loadStages } = useDealPipelines()
  const statusDictionary = useCustomerDictionary('deal-statuses')
  const stageDictionary = useCustomerDictionary('pipeline-stages')
  const sourceDictionary = useCustomerDictionary('sources')
  const [lossReasons, setLossReasons] = React.useState<DealMergeLossReason[]>([])

  React.useEffect(() => {
    let cancelled = false
    loadDictionaryEntriesByKey('sales.deal_loss_reason')
      .then((entries) => {
        if (!cancelled) setLossReasons(entries.map((entry) => ({ id: entry.id, label: entry.label })))
      })
      .catch((error: unknown) => {
        getTelemetryRuntime()?.reportError(error, {
          module: 'customers',
          code: 'customers.deal_merge_loss_reasons_load_failed',
        })
        if (!cancelled) setLossReasons([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const statusMap = statusDictionary.data?.map
  const pipelineLabel = React.useCallback(
    (pipelineId: string) => pipelines.find((pipeline) => pipeline.id === pipelineId)?.name ?? null,
    [pipelines],
  )
  const stageMap = stageDictionary.data?.map
  const statusLabel = React.useCallback(
    (status: string) => resolveDictionaryLabel(statusMap, DEAL_STATUS_DEFAULTS, status),
    [statusMap],
  )
  const stageLabel = React.useCallback(
    (stage: string) => resolveDictionaryLabel(stageMap, PIPELINE_STAGE_DEFAULTS, stage),
    [stageMap],
  )
  const sourceMap = sourceDictionary.data?.map
  const sourceLabel = React.useCallback(
    (source: string) => resolveDictionaryLabel(sourceMap, ENTITY_SOURCE_DEFAULTS, source),
    [sourceMap],
  )
  const lossReasonLabel = React.useCallback(
    (lossReasonId: string) => lossReasons.find((reason) => reason.id === lossReasonId)?.label ?? null,
    [lossReasons],
  )

  return {
    pipelines,
    stages,
    stagesPipelineId,
    stagesLoading,
    loadStages,
    lossReasons,
    pipelineLabel,
    statusLabel,
    stageLabel,
    sourceLabel,
    lossReasonLabel,
  }
}
