import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { OrderEditForm } from '../../../../../components/FreightOrderForm'

export default async function FreightOrderEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <OrderEditForm id={id} />
      </PageBody>
    </Page>
  )
}
