import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DictionarySettings from '../../../components/DictionarySettings'

export default function CustomersConfigurationPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <DictionarySettings />
      </PageBody>
    </Page>
  )
}
