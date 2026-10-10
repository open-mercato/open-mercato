import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import FreightAbstractDetail from '../../../../components/FreightAbstractDetail'

export default async function FreightAbstractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <FreightAbstractDetail id={id} />
      </PageBody>
    </Page>
  )
}
