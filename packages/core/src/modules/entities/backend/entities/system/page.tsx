import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import SystemEntitiesTable from '@open-mercato/core/modules/entities/components/SystemEntitiesTable'

export default function SystemEntitiesPage() {
  return (
    <Page>
      <PageBody>
        <SystemEntitiesTable />
      </PageBody>
    </Page>
  )
}
