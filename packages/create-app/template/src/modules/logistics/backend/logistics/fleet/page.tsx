import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageContent, LogisticsPageHeader } from '../../../components/LogisticsPage'

export default function FleetPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="fleet" />
      <PageBody>
        <LogisticsPageContent section="fleet" />
      </PageBody>
    </Page>
  )
}
