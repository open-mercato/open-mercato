import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { ComposeMessagePageClient } from '../../../components/ComposeMessagePageClient'

export default async function ComposeMessagePage() {
  return (
    <Page>
      <PageBody>
        <ComposeMessagePageClient />
      </PageBody>
    </Page>
  )
}
