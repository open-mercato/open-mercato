import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ApprovalStepCreateForm } from '../../../../components/ApprovalStepForm'

/**
 * Creating a step from inside a workflow starts with that workflow chosen: the link carries the id in
 * the query string, which is what makes the workflow's own steps screen a usable starting point.
 */
export default async function HrApprovalStepCreatePage({ searchParams }: { searchParams: Promise<{ workflowId?: string }> }) {
  const { workflowId } = await searchParams
  return (
    <Page>
      <PageBody>
        <ApprovalStepCreateForm workflowId={workflowId} />
      </PageBody>
    </Page>
  )
}
