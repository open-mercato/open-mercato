"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InventoryReservationsSection } from '../../../components/backend/WmsInventoryConsolePage'
import { useWmsInventoryMutationAccess } from '../../../components/backend/useWmsInventoryMutationAccess'
import { useWmsInventoryScopeFromSearchParams } from '../../../components/backend/useWmsInventoryScopeFromSearchParams'

export default function WmsReservationsPage() {
  const access = useWmsInventoryMutationAccess()
  const scope = useWmsInventoryScopeFromSearchParams()

  return (
    <Page>
      <PageBody>
        <InventoryReservationsSection
          access={access}
          warehouseId={scope.warehouseId}
          variantId={scope.catalogVariantId}
          lotId={scope.lotId}
        />
      </PageBody>
    </Page>
  )
}
