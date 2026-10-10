import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { TripEditForm } from '../../../../../components/FreightTripForm'

export default async function FreightTripEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <TripEditForm id={id} />
      </PageBody>
    </Page>
  )
}
