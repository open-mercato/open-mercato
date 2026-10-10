import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import RentalContractDetail from '../../../../components/RentalContractDetail'

export default async function RentalContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <RentalContractDetail id={id} />
      </PageBody>
    </Page>
  )
}
