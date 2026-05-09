import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LocationSection } from '../../../components/backend/WmsConfigurationPage'

export default function WmsLocationsPage() {
  return (
    <Page>
      <PageBody>
        <LocationSection />
      </PageBody>
    </Page>
  )
}
