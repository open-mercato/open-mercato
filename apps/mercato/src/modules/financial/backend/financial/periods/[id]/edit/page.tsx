import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PeriodEditForm } from '../../../../../components/FinancialPeriodForm'

export default async function FinancialPeriodEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <PeriodEditForm id={id} />
      </PageBody>
    </Page>
  )
}
