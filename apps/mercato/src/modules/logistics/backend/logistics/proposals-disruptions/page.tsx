import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LogisticsPageContent, LogisticsPageHeader } from '../../../components/LogisticsPage'

export default function ProposalsDisruptionsPage() {
  return (
    <Page data-testid="logistics-page">
      <LogisticsPageHeader section="proposalsDisruptions" />
      <PageBody>
        <LogisticsPageContent section="proposalsDisruptions" />
      </PageBody>
    </Page>
  )
}
