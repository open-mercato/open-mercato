import { Page } from '@open-mercato/ui/backend/Page'
import VendorInvoiceDetail from '../../../../../components/VendorInvoiceDetail'

export default async function VendorInvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <VendorInvoiceDetail id={id} />
    </Page>
  )
}
