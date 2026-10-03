import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { VehicleEditForm } from '../../../../../components/TransportVehicleForm'

export default async function TransportvehiclesEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <VehicleEditForm id={id} />
      </PageBody>
    </Page>
  )
}
