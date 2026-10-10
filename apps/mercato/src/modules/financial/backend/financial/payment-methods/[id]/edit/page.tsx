import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PaymentMethodEditForm } from '../../../../../components/PaymentMethodForm'

export default async function FinancialPaymentMethodEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <PaymentMethodEditForm id={id} />
      </PageBody>
    </Page>
  )
}
