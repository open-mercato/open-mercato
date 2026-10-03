import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { TripEditForm } from '../../../../../components/TransportTripForm'

export default async function TransporttripsEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <TripEditForm id={id} />
      </PageBody>
    </Page>
  )
}
