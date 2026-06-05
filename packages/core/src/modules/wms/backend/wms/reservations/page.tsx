"use client"

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { InventoryReservationsSection } from '../../../components/backend/WmsInventoryConsolePage'
import { useWmsInventoryMutationAccess } from '../../../components/backend/useWmsInventoryMutationAccess'

export default function WmsReservationsPage() {
  const access = useWmsInventoryMutationAccess()

  return (
    <Page>
      <PageBody>
        <InventoryReservationsSection access={access} />
      </PageBody>
    </Page>
  )
}
