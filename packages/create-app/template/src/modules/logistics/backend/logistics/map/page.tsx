import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageContent, LogisticsPageHeader } from '../../../components/LogisticsPage'

export default function MapPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="map" />
      <PageBody>
        <LogisticsPageContent section="map" />
      </PageBody>
    </Page>
  )
}
