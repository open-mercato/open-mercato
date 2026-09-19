import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageContent, LogisticsPageHeader } from '../../../components/LogisticsPage'

export default function StatisticsPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="statistics" />
      <PageBody>
        <LogisticsPageContent section="statistics" />
      </PageBody>
    </Page>
  )
}
