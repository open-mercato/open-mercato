import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { StatusSettings } from '../../../components/StatusSettings'
import { TaxRatesSettings } from '../../../components/TaxRatesSettings'
import { DocumentNumberSettings } from '../../../components/DocumentNumberSettings'
import { OrderEditingSettings } from '../../../components/OrderEditingSettings'
import { ShippingMethodsSettings } from '../../../components/ShippingMethodsSettings'
import { PaymentMethodsSettings } from '../../../components/PaymentMethodsSettings'

export default function SalesConfigurationPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <StatusSettings />
        <ShippingMethodsSettings />
        <PaymentMethodsSettings />
        <TaxRatesSettings />
        <OrderEditingSettings />
        <DocumentNumberSettings />
      </PageBody>
    </Page>
  )
}
