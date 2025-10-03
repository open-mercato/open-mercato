import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import UserEntitiesTable from '@open-mercato/core/modules/entities/components/UserEntitiesTable'

export default function UserEntitiesPage() {
  return (
    <Page>
      <PageBody>
        <UserEntitiesTable />
      </PageBody>
    </Page>
  )
}
