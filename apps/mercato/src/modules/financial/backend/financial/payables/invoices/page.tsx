import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import VendorInvoicesTable from '../../../../components/VendorInvoicesTable'

export default function VendorInvoicesPage() {
  return (
    <Page>
      <PageBody>
        <VendorInvoicesTable />
      </PageBody>
    </Page>
  )
}
