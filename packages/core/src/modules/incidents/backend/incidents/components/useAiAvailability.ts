"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type IncidentAiUnavailableReason = 'no_provider' | 'runtime_missing' | 'forbidden'

export type IncidentAiAvailability = {
  available: boolean | null
  reason: IncidentAiUnavailableReason | null
}

type AvailabilityResponse = {
  available?: boolean
  reason?: string
}

function normalizeReason(value: string | undefined): IncidentAiUnavailableReason | null {
  return value === 'no_provider' || value === 'runtime_missing' ? value : null
}

export function useIncidentAiAvailability(): IncidentAiAvailability {
  const [state, setState] = React.useState<IncidentAiAvailability>({ available: null, reason: null })

  React.useEffect(() => {
    let mounted = true
    apiCall<AvailabilityResponse>('/api/incidents/ai/availability')
      .then((call) => {
        if (!mounted) return
        if (call.status === 403) {
          setState({ available: false, reason: 'forbidden' })
          return
        }
        if (!call.ok || !call.result) {
          setState({ available: false, reason: null })
          return
        }
        setState({
          available: call.result.available === true,
          reason: call.result.available === true ? null : normalizeReason(call.result.reason),
        })
      })
      .catch(() => {
        if (mounted) setState({ available: false, reason: null })
      })
    return () => {
      mounted = false
    }
  }, [])

  return state
}
