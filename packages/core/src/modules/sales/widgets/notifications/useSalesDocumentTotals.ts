'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type DocumentKind = 'order' | 'quote'

type DocumentTotals = {
  grandTotalGrossAmount: number | null
  currencyCode: string | null
}

type DocumentListResponse = {
  items?: Array<{
    grandTotalGrossAmount?: number | string | null
    currencyCode?: string | null
  }>
}

const REFRESH_INTERVAL_MS = 30000

function buildDocumentTotalsUrl(kind: DocumentKind, documentId: string) {
  const params = new URLSearchParams({ id: documentId, page: '1', pageSize: '1' })
  const collection = kind === 'order' ? 'orders' : 'quotes'
  return `/api/sales/${collection}?${params.toString()}`
}

function extractTotals(payload: DocumentListResponse | null): DocumentTotals | null {
  const item = payload?.items?.[0]
  if (!item) return null
  const rawAmount = item.grandTotalGrossAmount
  let grandTotalGrossAmount: number | null = null
  if (typeof rawAmount === 'number') {
    grandTotalGrossAmount = Number.isNaN(rawAmount) ? null : rawAmount
  } else if (typeof rawAmount === 'string' && rawAmount.trim().length) {
    const parsed = Number(rawAmount)
    grandTotalGrossAmount = Number.isNaN(parsed) ? null : parsed
  }
  return {
    grandTotalGrossAmount,
    currencyCode: typeof item.currencyCode === 'string' ? item.currencyCode : null,
  }
}

export function useSalesDocumentTotals(kind: DocumentKind, documentId?: string | null) {
  const [totals, setTotals] = React.useState<DocumentTotals | null>(null)

  React.useEffect(() => {
    if (!documentId) {
      setTotals(null)
      return
    }

    let active = true

    const loadTotals = async () => {
      try {
        const call = await apiCall<DocumentListResponse>(buildDocumentTotalsUrl(kind, documentId))
        if (!active) return
        if (call.ok) {
          const nextTotals = extractTotals(call.result ?? null)
          setTotals(nextTotals)
        }
      } catch {
        if (active) {
          setTotals(null)
        }
      }
    }

    loadTotals()
    const interval = setInterval(loadTotals, REFRESH_INTERVAL_MS)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [kind, documentId])

  return { totals }
}
