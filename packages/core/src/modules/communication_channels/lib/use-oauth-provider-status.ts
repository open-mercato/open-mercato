'use client'

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type ProviderStatus = 'checking' | 'configured' | 'unconfigured' | 'unavailable'

export function useOAuthProviderStatus(providerKey: string | null) {
  const scopeVersion = useOrganizationScopeVersion()
  const [attempt, setAttempt] = React.useState(0)
  const [result, setResult] = React.useState<{ requestKey: string; status: ProviderStatus }>()
  const requestKey = JSON.stringify([providerKey, scopeVersion, attempt])

  React.useEffect(() => {
    if (!providerKey) return
    const controller = new AbortController()

    async function loadStatus(provider: string) {
      const response = await apiCall<{ configured?: boolean }>(
        `/api/communication_channels/oauth/${encodeURIComponent(provider)}/status`,
        { signal: controller.signal, cache: 'no-store' },
      ).catch(() => null)
      if (controller.signal.aborted) return
      const configured = response?.ok ? response.result?.configured : undefined
      const status = typeof configured === 'boolean'
        ? configured ? 'configured' : 'unconfigured'
        : 'unavailable'
      setResult({ requestKey, status })
    }

    void loadStatus(providerKey)
    return () => controller.abort()
  }, [providerKey, requestKey])

  const retry = React.useCallback(() => setAttempt((value) => value + 1), [])
  const markUnconfigured = React.useCallback(() => {
    setResult((current) => current?.requestKey === requestKey
      ? { requestKey, status: 'unconfigured' }
      : current)
  }, [requestKey])

  return {
    status: result?.requestKey === requestKey ? result.status : 'checking',
    retry,
    markUnconfigured,
  }
}
