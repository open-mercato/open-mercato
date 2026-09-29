import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { EntitySettingsManager } from '../../../components/EntitySettingsManager'

export default function EntitySettingsPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <EntitySettingsManager />
      </PageBody>
    </Page>
  )
}
