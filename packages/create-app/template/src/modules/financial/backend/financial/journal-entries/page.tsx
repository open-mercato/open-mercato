import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import FinancialEntriesTable from '../../../components/FinancialEntriesTable'

export default function FinancialEntriesPage() {
  return (
    <Page>
      <PageBody>
        <FinancialEntriesTable />
      </PageBody>
    </Page>
  )
}
