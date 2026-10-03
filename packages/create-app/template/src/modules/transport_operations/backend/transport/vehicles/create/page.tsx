import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { VehicleCreateForm } from '../../../../components/TransportVehicleForm'

export default function TransportvehiclesCreatePage() {
  return (
    <Page>
      <PageBody>
        <VehicleCreateForm />
      </PageBody>
    </Page>
  )
}
