import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ApprovalWorkflowEditForm } from '../../../../../components/ApprovalWorkflowForm'

export default async function HrApprovalWorkflowEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <ApprovalWorkflowEditForm id={id} />
      </PageBody>
    </Page>
  )
}
