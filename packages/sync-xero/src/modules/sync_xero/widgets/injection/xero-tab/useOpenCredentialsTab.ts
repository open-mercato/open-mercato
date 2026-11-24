"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

const HOST_TAB_QUERY_PARAM = 'tab'
const CREDENTIALS_TAB_ID = 'credentials'

/** Opens the host's Credentials tab through the `?tab=` URL the integration detail page keeps its active tab in sync with. */
export function useOpenCredentialsTab(): () => void {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  return React.useCallback(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set(HOST_TAB_QUERY_PARAM, CREDENTIALS_TAB_ID)
    router.replace(`${pathname ?? ''}?${params.toString()}`)
  }, [pathname, router, searchParams])
}
