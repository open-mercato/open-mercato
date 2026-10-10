import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CashAccountCreateForm } from '../../../../components/CashAccountForm'

export default function FinancialCashAccountCreatePage() {
  return (
    <Page>
      <PageBody>
        <CashAccountCreateForm />
      </PageBody>
    </Page>
  )
}
