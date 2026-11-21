"use client"

import * as React from 'react'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const OFFLOAD_FAILURE_STATUSES = ['encryption_unavailable', 'storage_unavailable'] as const

type OffloadFailureStatus = (typeof OFFLOAD_FAILURE_STATUSES)[number]

/**
 * Why a truncated inline summary has no offloaded full payload, read from the
 * `offloadStatus` the trace ingest stamps on it; null when the payload was
 * stored (or the summary predates the stamp).
 */
export function readOffloadFailureStatus(summary: unknown): OffloadFailureStatus | null {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const record = summary as Record<string, unknown>
  if (record._truncated !== true || record.offloaded === true) return null
  const status = record.offloadStatus
  return OFFLOAD_FAILURE_STATUSES.find((candidate) => candidate === status) ?? null
}

/** Explains, next to an inline preview, why its full payload was not stored. */
export function OffloadStatusNote({ summary }: { summary: unknown }) {
  const t = useT()
  const status = readOffloadFailureStatus(summary)
  if (!status) return null
  return (
    <Alert status="warning" size="xs" className="mt-1" data-testid="trace-offload-status">
      <AlertDescription>{t(`agent_orchestrator.trace.contentStatus.${status}`)}</AlertDescription>
    </Alert>
  )
}
