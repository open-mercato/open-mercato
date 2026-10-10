import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PeriodCreateForm } from '../../../../components/FinancialPeriodForm'

export default function FinancialPeriodCreatePage() {
  return (
    <Page>
      <PageBody>
        <PeriodCreateForm />
      </PageBody>
    </Page>
  )
}
