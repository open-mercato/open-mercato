import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { SearchSettingsPageClient } from '../../../frontend/components/SearchSettingsPageClient'

export default async function SearchSettingsPage() {
  return (
    <Page>
      <PageBody>
        <SearchSettingsPageClient />
      </PageBody>
    </Page>
  )
}
