import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { StatusSettings } from '../../../components/StatusSettings'
import { TaxRatesSettings } from '../../../components/TaxRatesSettings'
import { DocumentNumberSettings } from '../../../components/DocumentNumberSettings'

export default function SalesConfigurationPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <StatusSettings />
        <TaxRatesSettings />
        <DocumentNumberSettings />
      </PageBody>
    </Page>
  )
}
