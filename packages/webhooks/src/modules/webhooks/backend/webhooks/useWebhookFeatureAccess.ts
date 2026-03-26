"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { hasFeature } from '@open-mercato/shared/security/features'

type FeatureCheckResponse = {
  granted?: string[]
}

export function useWebhookFeatureAccess() {
  const [granted, setGranted] = React.useState<string[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const call = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            features: ['webhooks.view', 'webhooks.manage', 'webhooks.secrets', 'webhooks.test'],
          }),
        })

        if (!cancelled) {
          setGranted(Array.isArray(call.result?.granted) ? call.result.granted : [])
        }
      } catch {
        if (!cancelled) setGranted([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  return {
    isLoading,
    granted,
    canView: hasFeature(granted, 'webhooks.view'),
    canManage: hasFeature(granted, 'webhooks.manage'),
    canSecrets: hasFeature(granted, 'webhooks.secrets'),
    canTest: hasFeature(granted, 'webhooks.test'),
  }
}
