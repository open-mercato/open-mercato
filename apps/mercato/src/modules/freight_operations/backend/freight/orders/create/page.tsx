import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { OrderCreateForm } from '../../../../components/FreightOrderForm'

export default function FreightOrderCreatePage() {
  return (
    <Page>
      <PageBody>
        <OrderCreateForm />
      </PageBody>
    </Page>
  )
}
