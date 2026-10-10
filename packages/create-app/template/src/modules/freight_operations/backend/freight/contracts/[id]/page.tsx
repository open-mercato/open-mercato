import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import FreightContractDetail from '../../../../components/FreightContractDetail'

export default async function FreightContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <FreightContractDetail id={id} />
      </PageBody>
    </Page>
  )
}
