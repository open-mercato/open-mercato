"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { SALES_CHANNELS_TOGGLE_ID } from '../lib/salesChannelsToggleId'

export { SALES_CHANNELS_TOGGLE_ID }

const CACHE_TTL_MS = 60_000

type FeatureToggleCheckResponse = {
  ok?: boolean
  value?: unknown
}

// Fails open: channels stay visible unless the toggle explicitly resolves to
// false. A missing toggle definition (404) or an absent feature_toggles module
// must not hide sales channel UI.
async function fetchSalesChannelsEnabled(): Promise<boolean> {
  try {
    const call = await apiCall<FeatureToggleCheckResponse>(
      `/api/feature_toggles/check/boolean?identifier=${SALES_CHANNELS_TOGGLE_ID}`,
    )
    if (!call.ok) return true
    return !(call.result?.ok === true && call.result.value === false)
  } catch {
    return true
  }
}

let cache: { value: Promise<boolean>; at: number } | null = null

function getSalesChannelsEnabled(): Promise<boolean> {
  const now = Date.now()
  if (!cache || now - cache.at > CACHE_TTL_MS) {
    cache = { value: fetchSalesChannelsEnabled(), at: now }
  }
  return cache.value
}

export function useSalesChannelsEnabled(): { enabled: boolean; isLoading: boolean } {
  const [resolved, setResolved] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    let active = true
    getSalesChannelsEnabled()
      .then((value) => {
        if (active) setResolved(value)
      })
      .catch(() => {
        if (active) setResolved(true)
      })
    return () => {
      active = false
    }
  }, [])

  return { enabled: resolved !== false, isLoading: resolved === null }
}
