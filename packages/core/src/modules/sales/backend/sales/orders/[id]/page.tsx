"use client"

import SalesDocumentDetailPage from '../../documents/[id]/page'

export default function SalesOrderDetailPage(props: { params: { id: string } }) {
  return <SalesDocumentDetailPage {...props} initialKind="order" />
}
