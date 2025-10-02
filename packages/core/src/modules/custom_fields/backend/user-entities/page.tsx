import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import UserEntitiesTable from '../../components/UserEntitiesTable'

export default function UserEntitiesPage() {
  return (
    <Page>
      <PageBody>
        <UserEntitiesTable />
      </PageBody>
    </Page>
  )
}
