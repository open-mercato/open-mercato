"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import {
  InventoryMovementsSection,
} from '../../../components/backend/WmsInventoryConsolePage'
import { useWmsInventoryScopeFromSearchParams } from '../../../components/backend/useWmsInventoryScopeFromSearchParams'

export default function WmsMovementsPage() {
  const scope = useWmsInventoryScopeFromSearchParams()

  return (
    <Page>
      <PageBody>
        <InventoryMovementsSection
          warehouseId={scope.warehouseId}
          variantId={scope.catalogVariantId}
          lotId={scope.lotId}
        />
      </PageBody>
    </Page>
  )
}
