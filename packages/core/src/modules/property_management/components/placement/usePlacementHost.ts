"use client"

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useFloorLayout } from '../floor/useFloorLayout'
import type { FloorLayoutData } from '../floor/types'

export type PlacementRecord = Record<string, unknown> & { id: string; floorId: string; updatedAt: string | null }

export type PlacementHostState<T extends PlacementRecord> = {
  record: T | null
  layout: FloorLayoutData | null
  loading: boolean
  notFound: boolean
  error: boolean
  reload: () => void
}

function isPlacementRecord(value: unknown): value is PlacementRecord {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.floorId === 'string'
}

export function usePlacementHost<T extends PlacementRecord>(
  resource: 'spaces' | 'units' | 'common-areas',
  recordId: string | null,
): PlacementHostState<T> {
  const searchParams = useSearchParams()
  const queryFloorId = searchParams?.get('floorId') ?? null
  const [record, setRecord] = React.useState<T | null>(null)
  const [recordLoading, setRecordLoading] = React.useState(Boolean(recordId))
  const [recordMissing, setRecordMissing] = React.useState(false)
  const [recordError, setRecordError] = React.useState(false)
  const [token, setToken] = React.useState(0)

  React.useEffect(() => {
    if (!recordId) return
    let cancelled = false
    setRecordLoading(true)
    setRecordError(false)
    apiCall<{ items?: unknown[] }>(`/api/property_management/${resource}?id=${encodeURIComponent(recordId)}&pageSize=1`)
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setRecordError(true)
          return
        }
        const item = Array.isArray(call.result?.items) ? call.result?.items[0] : null
        if (isPlacementRecord(item)) {
          setRecord(item as T)
          setRecordMissing(false)
        } else {
          setRecordMissing(true)
        }
      })
      .catch(() => {
        if (!cancelled) setRecordError(true)
      })
      .finally(() => {
        if (!cancelled) setRecordLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [recordId, resource, token])

  const floorId = recordId ? record?.floorId ?? null : queryFloorId
  const floor = useFloorLayout(recordId && !record ? null : floorId)
  const floorReload = floor.reload
  const reload = React.useCallback(() => {
    setToken((value) => value + 1)
    floorReload()
  }, [floorReload])

  if (recordId && (recordLoading || (!record && !recordMissing && !recordError))) {
    return { record: null, layout: null, loading: true, notFound: false, error: false, reload }
  }
  return {
    record,
    layout: floor.data,
    loading: floor.loading,
    notFound: recordMissing || floor.notFound,
    error: recordError || floor.error,
    reload,
  }
}
