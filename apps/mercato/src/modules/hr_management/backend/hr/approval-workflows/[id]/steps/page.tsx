import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ApprovalStepsTable from '../../../../../components/ApprovalStepsTable'

/**
 * One workflow's steps.
 *
 * Nested under the workflow rather than filtered from the global list: the steps only mean anything
 * in relation to their workflow, and this URL is what the workflow row's "Steps" link points at.
 */
export default async function HrApprovalWorkflowStepsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <ApprovalStepsTable workflowId={id} />
      </PageBody>
    </Page>
  )
}
