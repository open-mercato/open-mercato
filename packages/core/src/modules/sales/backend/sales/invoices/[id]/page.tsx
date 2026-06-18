"use client"

import { InvoiceDetailPage } from '@open-mercato/core/modules/sales/components/documents/InvoiceDetailPage'

export default function SalesInvoicePage({ params }: { params: { id: string } }) {
  return <InvoiceDetailPage id={params.id} />
}
