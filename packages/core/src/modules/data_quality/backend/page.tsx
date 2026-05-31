import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataQualityOverviewClient } from '../components/DataQualityOverviewClient'

export { metadata } from './page.meta'

export default function DataQualityOverviewPage() {
  return (
    <Page>
      <PageBody>
        <DataQualityOverviewClient />
      </PageBody>
    </Page>
  )
}
