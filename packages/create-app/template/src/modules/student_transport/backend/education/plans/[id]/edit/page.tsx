import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PlanEditForm } from '../../../../../components/PlanForm'

export default async function EducationPlanEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <PlanEditForm id={id} />
      </PageBody>
    </Page>
  )
}
