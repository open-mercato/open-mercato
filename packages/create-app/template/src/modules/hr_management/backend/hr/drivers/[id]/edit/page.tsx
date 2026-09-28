import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DriverEditForm } from '../../../../../components/DriverForm'

export default async function HrDriverEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Page>
      <PageBody>
        <DriverEditForm id={id} />
      </PageBody>
    </Page>
  )
}
