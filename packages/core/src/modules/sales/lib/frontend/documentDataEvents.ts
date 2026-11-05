"use client"

export const SALES_DOCUMENT_DATA_REFRESH_EVENT = 'sales:document:data:refresh'

export type SalesDocumentDataRefreshDetail = {
  documentId: string
  kind?: 'order' | 'quote'
}

export function emitSalesDocumentDataRefresh(detail: SalesDocumentDataRefreshDetail): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<SalesDocumentDataRefreshDetail>(SALES_DOCUMENT_DATA_REFRESH_EVENT, { detail }),
  )
}

export function subscribeSalesDocumentDataRefresh(
  handler: (detail: SalesDocumentDataRefreshDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<SalesDocumentDataRefreshDetail>).detail
    if (!detail) return
    handler(detail)
  }
  window.addEventListener(SALES_DOCUMENT_DATA_REFRESH_EVENT, listener as EventListener)
  return () => window.removeEventListener(SALES_DOCUMENT_DATA_REFRESH_EVENT, listener as EventListener)
}
