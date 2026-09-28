import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EmployeeDocumentEditForm } from '../../../../../components/EmployeeDocumentForm'

export default async function HrDocumentEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <EmployeeDocumentEditForm id={id} />
      </PageBody>
    </Page>
  )
}
