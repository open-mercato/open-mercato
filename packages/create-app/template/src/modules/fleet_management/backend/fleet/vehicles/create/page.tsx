import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { VehicleCreateForm } from '../../../../components/VehicleForm'

export default function FleetVehicleCreatePage() {
  return (
    <Page>
      <PageBody>
        <VehicleCreateForm />
      </PageBody>
    </Page>
  )
}
