import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DeliveryNotesTable from '../../../components/DeliveryNotesTable'

export default function FreightDeliveryNotesPage() {
  return (
    <Page>
      <PageBody>
        <DeliveryNotesTable />
      </PageBody>
    </Page>
  )
}
