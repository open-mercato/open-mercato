import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { PriceKindSettings } from '../../../components/PriceKindSettings'
import { UnitPriceDisplaySettings } from '../../../components/UnitPriceDisplaySettings'
import { OmnibusSettings } from '../../../components/OmnibusSettings'
import { AiCategorizationSettings } from '../../../components/AiCategorizationSettings'

export default function CatalogConfigurationPage() {
  return (
    <Page>
      <PageBody className="space-y-8">
        <PriceKindSettings />
        <UnitPriceDisplaySettings />
        <OmnibusSettings />
        <AiCategorizationSettings />
      </PageBody>
    </Page>
  )
}
