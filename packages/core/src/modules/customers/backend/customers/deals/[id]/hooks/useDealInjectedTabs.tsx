import * as React from 'react'
import { useCustomerInjectedTabs } from '../../../../../components/detail/useCustomerInjectedTabs'
import { DEAL_DETAIL_TAB_IDS } from '../../../../../components/detail/DealDetailTabs'
import { extensionPoints } from '../../../../../extension-points'
import type { DealDetailPayload } from './types'

type UseDealInjectedTabsOptions = {
  injectionContext: unknown
  data: DealDetailPayload | null
  setData: React.Dispatch<React.SetStateAction<DealDetailPayload | null>>
}

export function useDealInjectedTabs({
  injectionContext,
  data,
  setData,
}: UseDealInjectedTabsOptions) {
  return useCustomerInjectedTabs({
    spotId: extensionPoints.hosts.dealTabs.spotId,
    context: injectionContext,
    data,
    onDataChange: setData,
    nativeTabIds: DEAL_DETAIL_TAB_IDS,
  })
}
