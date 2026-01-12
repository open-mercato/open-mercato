import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { HybridSearchTable } from '../../frontend/components/HybridSearchTable'

export default async function HybridSearchPage() {
  return (
    <Page>
      <PageBody>
        <HybridSearchTable />
      </PageBody>
    </Page>
  )
}
