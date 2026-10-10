import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import FreightTripDetail from '../../../../components/FreightTripDetail'

export default async function FreightTripDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <FreightTripDetail id={id} />
      </PageBody>
    </Page>
  )
}
