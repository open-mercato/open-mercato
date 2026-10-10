import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CashAccountEditForm } from '../../../../../components/CashAccountForm'

export default async function FinancialCashAccountEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <CashAccountEditForm id={id} />
      </PageBody>
    </Page>
  )
}
