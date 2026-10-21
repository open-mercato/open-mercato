import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { VendorInvoiceEditForm } from '../../../../../../components/VendorInvoiceForm'

export default async function VendorInvoiceEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <VendorInvoiceEditForm id={id} />
      </PageBody>
    </Page>
  )
}
