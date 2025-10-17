import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CustomerTodosTable } from './components/CustomerTodosTable'

export default function CustomerRelatedTodosPage() {
  return (
    <Page>
      <PageBody>
        <CustomerTodosTable />
      </PageBody>
    </Page>
  )
}
