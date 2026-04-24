import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InventoryMovementsSection } from '../../../components/backend/WmsInventoryConsolePage'

export default function WmsMovementsPage() {
  return (
    <Page>
      <PageBody>
        <InventoryMovementsSection />
      </PageBody>
    </Page>
  )
}
