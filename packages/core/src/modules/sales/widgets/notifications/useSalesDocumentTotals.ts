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
    grandTotalGrossAmount?: number | null
    currencyCode?: string | null
  }>
}

const REFRESH_INTERVAL_MS = 30000

function buildDocumentTotalsUrl(kind: DocumentKind, documentId: string) {
  const params = new URLSearchParams({ id: documentId, pageSize: '1' })
  const collection = kind === 'order' ? 'orders' : 'quotes'
  return `/api/sales/${collection}?${params.toString()}`
}

function extractTotals(payload: DocumentListResponse | null): DocumentTotals | null {
  const item = payload?.items?.[0]
  if (!item) return null
  return {
    grandTotalGrossAmount:
      typeof item.grandTotalGrossAmount === 'number' ? item.grandTotalGrossAmount : null,
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
      const call = await apiCall<DocumentListResponse>(buildDocumentTotalsUrl(kind, documentId))
      if (active && call.ok) {
        const nextTotals = extractTotals(call.result ?? null)
        if (nextTotals) setTotals(nextTotals)
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
