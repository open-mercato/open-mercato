import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import VendorPaymentsTable from '../../../../components/VendorPaymentsTable'

export default function VendorPaymentsPage() {
  return (
    <Page>
      <PageBody>
        <VendorPaymentsTable />
      </PageBody>
    </Page>
  )
}
