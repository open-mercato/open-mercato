import { Page } from '@open-mercato/ui/backend/Page'
import PayrollRunDetail from '../../../../components/PayrollRunDetail'

export default async function PayrollRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PayrollRunDetail id={id} />
    </Page>
  )
}
