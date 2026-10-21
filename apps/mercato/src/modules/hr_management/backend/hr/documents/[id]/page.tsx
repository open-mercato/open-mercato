import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import EmployeeDocumentDetail from '../../../../components/EmployeeDocumentDetail'

export default async function EmployeeDocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <EmployeeDocumentDetail id={id} />
      </PageBody>
    </Page>
  )
}
