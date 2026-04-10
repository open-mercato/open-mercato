"use client"

import FinancialDocumentDetailPage from '../../../../components/documents/FinancialDocumentDetailPage'

export default function SalesInvoiceDetailPage({ params }: { params: { id: string } }) {
  return <FinancialDocumentDetailPage params={params} kind="invoice" />
}
