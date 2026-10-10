import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import FinancialPeriodsTable from '../../../components/FinancialPeriodsTable'

export default function FinancialPeriodsPage() {
  return (
    <Page>
      <PageBody>
        <FinancialPeriodsTable />
      </PageBody>
    </Page>
  )
}
