import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ApprovalStepEditForm } from '../../../../../components/ApprovalStepForm'

export default async function HrApprovalStepEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <ApprovalStepEditForm id={id} />
      </PageBody>
    </Page>
  )
}
