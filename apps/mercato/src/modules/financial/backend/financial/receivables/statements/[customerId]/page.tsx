import { Page } from '@open-mercato/ui/backend/Page'
import CustomerStatementView from '../../../../../components/CustomerStatementView'

export default async function CustomerStatementPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params
  return (
    <Page>
      <CustomerStatementView customerId={customerId} />
    </Page>
  )
}
