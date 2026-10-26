"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { XeroConnectionView } from './types'

export type XeroConnectionState = {
  connection: XeroConnectionView | null
  isLoading: boolean
  hasError: boolean
  reload: () => Promise<void>
}

export function useXeroConnection(): XeroConnectionState {
  const [connection, setConnection] = React.useState<XeroConnectionView | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [hasError, setHasError] = React.useState(false)

  const reload = React.useCallback(async () => {
    setHasError(false)
    try {
      const call = await apiCall<XeroConnectionView>('/api/sync_xero/connection', undefined, { fallback: null })
      if (call.ok && call.result) setConnection(call.result)
      else setHasError(true)
    } catch {
      setHasError(true)
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  return { connection, isLoading, hasError, reload }
}
