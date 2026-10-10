import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import FinancialAccountsTable from '../../../components/FinancialAccountsTable'

export default function FinancialAccountsPage() {
  return (
    <Page>
      <PageBody>
        <FinancialAccountsTable />
      </PageBody>
    </Page>
  )
}
