import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageContent, LogisticsPageHeader } from '../../../components/LogisticsPage'

export default function TripsPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="trips" />
      <PageBody>
        <LogisticsPageContent section="trips" />
      </PageBody>
    </Page>
  )
}
