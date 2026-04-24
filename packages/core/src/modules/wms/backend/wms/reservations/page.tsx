import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InventoryReservationsSection } from '../../../components/backend/WmsInventoryConsolePage'

export default function WmsReservationsPage() {
  return (
    <Page>
      <PageBody>
        <InventoryReservationsSection />
      </PageBody>
    </Page>
  )
}
