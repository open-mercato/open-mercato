import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DepartmentEditForm } from '../../../../../components/DepartmentForm'

export default async function HrDepartmentEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <DepartmentEditForm id={id} />
      </PageBody>
    </Page>
  )
}
