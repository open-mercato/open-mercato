"use client"

import FinancialDocumentDetailPage from '../../../../components/documents/FinancialDocumentDetailPage'

export default function SalesCreditMemoDetailPage({ params }: { params: { id: string } }) {
  return <FinancialDocumentDetailPage params={params} kind="credit-memo" />
}
