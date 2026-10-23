"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash, type FlashKind } from '@open-mercato/ui/backend/FlashMessages'
import { XERO_CALLBACK_RESULTS, XERO_RESULT_QUERY_PARAM, type XeroCallbackResult } from '../../../lib/constants'

const KNOWN_RESULTS: ReadonlySet<string> = new Set(XERO_CALLBACK_RESULTS)

export function xeroResultFlashKind(result: XeroCallbackResult): FlashKind {
  if (result === 'connected') return 'success'
  if (result === 'account_pending') return 'info'
  if (result === 'connect_cancelled') return 'warning'
  return 'error'
}

export function readXeroResult(value: string | null | undefined): XeroCallbackResult | null {
  if (!value) return null
  return KNOWN_RESULTS.has(value) ? (value as XeroCallbackResult) : 'connect_failed'
}

/** Shows the callback's `xeroResult` once as a flash message, removes it from the URL and reloads the tab. */
export function useXeroResultFlash(onResult: () => Promise<void>): void {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const result = readXeroResult(searchParams?.get(XERO_RESULT_QUERY_PARAM))
  const handledQuery = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (!result) return
    const currentQuery = searchParams?.toString() ?? ''
    if (handledQuery.current === currentQuery) return
    handledQuery.current = currentQuery
    flash(t(`sync_xero.result.${result}`), xeroResultFlashKind(result))
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete(XERO_RESULT_QUERY_PARAM)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname ?? '')
    void onResult()
  }, [onResult, pathname, result, router, searchParams, t])
}
