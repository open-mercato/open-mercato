import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import DictionarySettings from '../../../components/DictionarySettings'
import AddressFormatSettings from '../../../components/AddressFormatSettings'

export default function CustomersConfigurationPage() {
  return (
    <Page>
    <PageBody>
      <div className="space-y-8">
        <AddressFormatSettings />
        <DictionarySettings />
      </div>
    </PageBody>
    </Page>
  )
}
