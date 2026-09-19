import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageContent, LogisticsPageHeader } from '../../../components/LogisticsPage'

export default function TransportJobsPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="transportJobs" />
      <PageBody>
        <LogisticsPageContent section="transportJobs" />
      </PageBody>
    </Page>
  )
}
