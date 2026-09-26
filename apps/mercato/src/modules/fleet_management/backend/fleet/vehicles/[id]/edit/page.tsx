import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { VehicleEditForm } from '../../../../../components/VehicleForm'

export default async function FleetVehicleEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <VehicleEditForm id={id} />
      </PageBody>
    </Page>
  )
}
