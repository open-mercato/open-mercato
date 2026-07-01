import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { WarehouseSection } from '../../../components/backend/WmsConfigurationPage'

export default function WmsWarehousesPage() {
  return (
    <Page>
      <PageBody>
        <WarehouseSection />
      </PageBody>
    </Page>
  )
}
