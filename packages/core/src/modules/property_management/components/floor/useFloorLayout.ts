"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { FloorLayoutData } from './types'

export type FloorLayoutState = {
  data: FloorLayoutData | null
  loading: boolean
  notFound: boolean
  error: boolean
  reload: () => void
}

export function useFloorLayout(floorId: string | null): FloorLayoutState {
  const [data, setData] = React.useState<FloorLayoutData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [notFound, setNotFound] = React.useState(false)
  const [error, setError] = React.useState(false)
  const [token, setToken] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    if (!floorId) {
      setLoading(false)
      setNotFound(true)
      return
    }
    setLoading(true)
    setError(false)
    setNotFound(false)
    apiCall<FloorLayoutData>(`/api/property_management/floors/${encodeURIComponent(floorId)}/layout`)
      .then((call) => {
        if (cancelled) return
        if (call.status === 404) {
          setNotFound(true)
          setData(null)
        } else if (!call.ok || !call.result) {
          setError(true)
        } else {
          setData(call.result)
        }
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [floorId, token])

  const reload = React.useCallback(() => setToken((value) => value + 1), [])
  return { data, loading, notFound, error, reload }
}
