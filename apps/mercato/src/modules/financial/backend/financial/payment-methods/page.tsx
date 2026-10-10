import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import PaymentMethodsTable from '../../../components/PaymentMethodsTable'

export default function FinancialPaymentMethodsPage() {
  return (
    <Page>
      <PageBody>
        <PaymentMethodsTable />
      </PageBody>
    </Page>
  )
}
