import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import ExternalOrdersTable from '../../../components/ExternalOrdersTable'

export default function FreightExternalOrdersPage() {
  return (
    <Page>
      <PageBody>
        <ExternalOrdersTable />
      </PageBody>
    </Page>
  )
}
