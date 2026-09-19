import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageContent, LogisticsPageHeader } from '../../components/LogisticsPage'

export default function DashboardPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="dashboard" />
      <PageBody>
        <LogisticsPageContent section="dashboard" />
      </PageBody>
    </Page>
  )
}
