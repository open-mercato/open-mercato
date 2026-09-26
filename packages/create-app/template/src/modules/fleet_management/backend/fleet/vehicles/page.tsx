import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import VehiclesTable from '../../../components/VehiclesTable'

export default function FleetVehiclesPage() {
  return (
    <Page>
      <PageBody>
        <VehiclesTable />
      </PageBody>
    </Page>
  )
}