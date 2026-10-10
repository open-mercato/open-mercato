import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PaymentMethodCreateForm } from '../../../../components/PaymentMethodForm'

export default function FinancialPaymentMethodCreatePage() {
  return (
    <Page>
      <PageBody>
        <PaymentMethodCreateForm />
      </PageBody>
    </Page>
  )
}
