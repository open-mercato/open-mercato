'use client'

import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { STORE_MANAGE_FEATURE } from './storeAdmin'

export type StoreAccess = {
  isResolved: boolean
  canManage: boolean
}

export function useStoreAccess(): StoreAccess {
  const { payload } = useBackendChrome()
  const granted = payload?.grantedFeatures
  return {
    isResolved: Array.isArray(granted),
    canManage: hasFeature(granted, STORE_MANAGE_FEATURE),
  }
}
