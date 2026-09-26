import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import VehicleDocumentsTable from '../../../components/VehicleDocumentsTable'

export default function FleetDocumentsPage() {
  return (
    <Page>
      <PageBody>
        <VehicleDocumentsTable />
      </PageBody>
    </Page>
  )
}