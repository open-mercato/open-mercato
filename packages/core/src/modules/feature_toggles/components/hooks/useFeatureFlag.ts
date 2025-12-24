"use client"

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type UseFeatureFlagOptions = {
  id: string
}

export type UseFeatureFlagResult = {
  enabled: boolean
  isLoading: boolean
}

export function useFeatureFlag(options: UseFeatureFlagOptions): UseFeatureFlagResult {
  const query = useQuery({
    queryKey: ['featureToggles', 'check', options?.id],
    queryFn: async () => {
      const params = new URLSearchParams({
        identifier: options.id,
      })

      return await readApiResultOrThrow<{ enabled: boolean }>(
        `/api/feature_toggles/check?${params.toString()}`,
        undefined,
        { errorMessage: 'Failed to check feature flag.' },
      )
    },
    enabled: !!options.id,
  })

  const enabled = query.data?.enabled ?? false
  const isLoading = query.isLoading

  return {
    enabled,
    isLoading,
  }
}
