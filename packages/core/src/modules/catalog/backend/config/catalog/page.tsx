import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { OmnibusSettings } from '../../../components/OmnibusSettings'
import { PriceKindSettings } from '../../../components/PriceKindSettings'
import { UnitPriceDisplaySettings } from '../../../components/UnitPriceDisplaySettings'

export default function CatalogConfigurationPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <PriceKindSettings />
        <UnitPriceDisplaySettings />
        <OmnibusSettings />
      </PageBody>
    </Page>
  )
}
