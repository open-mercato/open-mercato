import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import CashAccountsTable from '../../../components/CashAccountsTable'

export default function FinancialCashAccountsPage() {
  return (
    <Page>
      <PageBody>
        <CashAccountsTable />
      </PageBody>
    </Page>
  )
}
