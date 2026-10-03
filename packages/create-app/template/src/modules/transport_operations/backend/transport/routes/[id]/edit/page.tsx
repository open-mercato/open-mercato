import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { RouteEditForm } from '../../../../../components/TransportRouteForm'

export default async function TransportroutesEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <RouteEditForm id={id} />
      </PageBody>
    </Page>
  )
}
