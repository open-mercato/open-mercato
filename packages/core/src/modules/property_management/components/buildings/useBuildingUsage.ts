"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { BuildingUsage } from './buildingRecord'

export type BuildingUsageState = { usage: BuildingUsage | null; loading: boolean; failed: boolean; retry: () => void }

type UsageLoad = Omit<BuildingUsageState, 'retry'>

export function useBuildingUsage(buildingId: string | null, enabled: boolean): BuildingUsageState {
  const [state, setState] = React.useState<UsageLoad>({ usage: null, loading: false, failed: false })
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (!enabled || !buildingId) return
    let cancelled = false
    setState({ usage: null, loading: true, failed: false })
    apiCall<BuildingUsage>(`/api/property_management/buildings/${encodeURIComponent(buildingId)}/archive`)
      .then((call) => {
        if (cancelled) return
        if (call.ok && call.result) setState({ usage: call.result, loading: false, failed: false })
        else setState({ usage: null, loading: false, failed: true })
      })
      .catch(() => {
        if (!cancelled) setState({ usage: null, loading: false, failed: true })
      })
    return () => {
      cancelled = true
    }
  }, [buildingId, enabled, attempt])

  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  return { ...state, retry }
}

export function isSubmitShortcut(event: React.KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && event.key === 'Enter'
}
