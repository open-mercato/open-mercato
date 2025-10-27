import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { StatusSettings } from '../../../components/StatusSettings'

export default function SalesConfigurationPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <StatusSettings />
      </PageBody>
    </Page>
  )
}
