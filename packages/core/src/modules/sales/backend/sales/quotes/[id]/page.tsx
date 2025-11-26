"use client"

import SalesDocumentDetailPage from '../../documents/[id]/page'

export default function SalesQuoteDetailPage(props: { params: { id: string } }) {
  return <SalesDocumentDetailPage {...props} initialKind="quote" />
}
