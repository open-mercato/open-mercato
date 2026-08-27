"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

export type DemoPortalAccount = {
  email: string
  password: string
  roles: Array<{ id: string; name: string; slug: string }>
}

type DemoAccountsResponse = {
  items?: DemoPortalAccount[]
}

/**
 * Loads the example-data portal accounts that exist in the current organization.
 * Callers render demo credentials only for what comes back, so an installation
 * started with `--no-examples` shows nothing at all (#5669). A failed lookup
 * resolves to an empty list — never to a hardcoded fallback.
 */
export function useDemoPortalAccounts(): { accounts: DemoPortalAccount[]; isLoading: boolean } {
  const [accounts, setAccounts] = React.useState<DemoPortalAccount[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const call = await apiCall<DemoAccountsResponse>('/api/customer_accounts/admin/demo-accounts')
        if (cancelled) return
        const items = call.ok && Array.isArray(call.result?.items) ? call.result!.items : []
        setAccounts(items)
      } catch {
        if (!cancelled) setAccounts([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { accounts, isLoading }
}
