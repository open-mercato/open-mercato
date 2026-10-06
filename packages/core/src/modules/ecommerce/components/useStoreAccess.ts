'use client'

import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import {
  AVAILABILITY_MANAGE_FEATURE,
  AVAILABILITY_VIEW_FEATURE,
  BRANDING_MANAGE_FEATURE,
  CHANNELS_MANAGE_FEATURE,
  DOMAINS_MANAGE_FEATURE,
  STORE_MANAGE_FEATURE,
} from './storeAdmin'

export type StoreAccess = {
  isResolved: boolean
  canManage: boolean
  canManageBranding: boolean
  canManageDomains: boolean
  canManageChannels: boolean
  canViewAvailability: boolean
  canManageAvailability: boolean
}

export function useStoreAccess(): StoreAccess {
  const { payload } = useBackendChrome()
  const granted = payload?.grantedFeatures
  return {
    isResolved: Array.isArray(granted),
    canManage: hasFeature(granted, STORE_MANAGE_FEATURE),
    canManageBranding: hasFeature(granted, BRANDING_MANAGE_FEATURE),
    canManageDomains: hasFeature(granted, DOMAINS_MANAGE_FEATURE),
    canManageChannels: hasFeature(granted, CHANNELS_MANAGE_FEATURE),
    canViewAvailability: hasFeature(granted, AVAILABILITY_VIEW_FEATURE),
    canManageAvailability: hasFeature(granted, AVAILABILITY_MANAGE_FEATURE),
  }
}
