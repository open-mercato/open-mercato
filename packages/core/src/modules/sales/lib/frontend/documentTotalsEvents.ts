"use client"

export const SALES_DOCUMENT_TOTALS_REFRESH_EVENT = 'sales:document:totals:refresh'

export type SalesDocumentTotalsRefreshDetail = {
  documentId: string
  kind?: 'order' | 'quote'
}

export function emitSalesDocumentTotalsRefresh(detail: SalesDocumentTotalsRefreshDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<SalesDocumentTotalsRefreshDetail>(SALES_DOCUMENT_TOTALS_REFRESH_EVENT, { detail }),
  )
}

export function subscribeSalesDocumentTotalsRefresh(
  handler: (detail: SalesDocumentTotalsRefreshDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SalesDocumentTotalsRefreshDetail>).detail
    if (!detail) return
    handler(detail)
  }
  window.addEventListener(SALES_DOCUMENT_TOTALS_REFRESH_EVENT, listener as EventListener)
  return () => window.removeEventListener(SALES_DOCUMENT_TOTALS_REFRESH_EVENT, listener as EventListener)
}
