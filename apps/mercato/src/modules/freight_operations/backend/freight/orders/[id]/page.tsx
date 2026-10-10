import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import FreightOrderDetail from '../../../../components/FreightOrderDetail'

export default async function FreightOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <FreightOrderDetail id={id} />
      </PageBody>
    </Page>
  )
}
