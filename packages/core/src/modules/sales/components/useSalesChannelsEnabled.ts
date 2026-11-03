"use client"

import { useFeatureFlagBoolean } from '@open-mercato/core/modules/feature_toggles/components/hooks/useFeatureFlagBoolean'
import { SALES_CHANNELS_TOGGLE_ID } from '../lib/salesChannelsToggleId'

export { SALES_CHANNELS_TOGGLE_ID }

// Fails open: channels stay visible unless the toggle explicitly resolves to
// false. A missing toggle definition (404) or an absent feature_toggles module
// must not hide sales channel UI.
export function useSalesChannelsEnabled(): { enabled: boolean; isLoading: boolean } {
  return useFeatureFlagBoolean({ id: SALES_CHANNELS_TOGGLE_ID, defaultValue: true })
}
