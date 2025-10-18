import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DictionarySettings from '../../../components/DictionarySettings'
import AddressFormatSettings from '../../../components/AddressFormatSettings'

export default function CustomersConfigurationPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <AddressFormatSettings />
        <DictionarySettings />
      </PageBody>
    </Page>
  )
}
