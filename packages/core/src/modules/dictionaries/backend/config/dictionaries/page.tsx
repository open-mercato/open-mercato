import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DictionariesManager } from '../../../components/DictionariesManager'

export default function DictionariesConfigurationPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <DictionariesManager />
      </PageBody>
    </Page>
  )
}
