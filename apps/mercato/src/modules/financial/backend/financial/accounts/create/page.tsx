import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { AccountCreateForm } from '../../../../components/FinancialAccountForm'

export default function FinancialAccountCreatePage() {
  return (
    <Page>
      <PageBody>
        <AccountCreateForm />
      </PageBody>
    </Page>
  )
}
