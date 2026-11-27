"use client"

import * as React from 'react'
import { apiCall } from '../utils/apiCall'

export type ComposeSchedulingCapability = { available: boolean; maxDays: number }

export function useComposeScheduling(enabled = true): ComposeSchedulingCapability | null {
  const [scheduling, setScheduling] = React.useState<ComposeSchedulingCapability | null>(null)

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      try {
        const response = await apiCall<{ schedulingAvailable?: boolean; scheduleMaxDays?: number }>(
          '/api/messages/compose-capabilities',
          { method: 'GET', headers: { 'x-om-forbidden-redirect': '0', 'x-om-unauthorized-redirect': '0' } },
        )
        if (cancelled || !response.ok) return
        setScheduling({
          available: response.result?.schedulingAvailable === true,
          maxDays: typeof response.result?.scheduleMaxDays === 'number' ? response.result.scheduleMaxDays : 0,
        })
      } catch {
        if (!cancelled) setScheduling(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])

  return scheduling
}
