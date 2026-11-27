"use client"

import { hasFeature } from '@open-mercato/shared/security/features'
import { useBackendChrome } from '../backend/BackendChromeProvider'

export const AI_ASSISTANT_RUNS_VIEW_FEATURE = 'ai_assistant.runs.view'

const AI_RUN_DETAIL_PATH = '/backend/config/ai-assistant/runs'

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function readRunIdFromLoopTrace(trace: unknown): string | null {
  if (!trace || typeof trace !== 'object') return null
  return readNonEmptyString((trace as { runId?: unknown }).runId)
}

export function readRunIdFromMessageMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  return readNonEmptyString((metadata as { runId?: unknown }).runId)
}

export function buildAiRunTraceHref(runId: string): string {
  return `${AI_RUN_DETAIL_PATH}/${encodeURIComponent(runId)}`
}

export function useCanViewAiRunTrace(): boolean {
  const { payload } = useBackendChrome()
  return hasFeature(payload?.grantedFeatures, AI_ASSISTANT_RUNS_VIEW_FEATURE)
}
