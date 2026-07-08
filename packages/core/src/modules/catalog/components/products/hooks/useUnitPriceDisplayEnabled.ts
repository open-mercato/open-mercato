"use client"

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

type CatalogSettingsResponse = {
  unitPriceDisplayEnabled?: boolean
}

export type UseUnitPriceDisplayEnabledResult = {
  enabled: boolean
  isLoading: boolean
}

/**
 * Resolves the tenant-scoped catalog setting that controls whether the EU unit
 * price presentation feature is available on the product form. Defaults to
 * enabled while loading (and on failure) so the common retail case is never
 * hidden by a transient error.
 */
export function useUnitPriceDisplayEnabled(): UseUnitPriceDisplayEnabledResult {
  const query = useQuery({
    queryKey: ['catalog', 'settings', 'unitPriceDisplayEnabled'],
    queryFn: async () => {
      const result = await readApiResultOrThrow<CatalogSettingsResponse>(
        '/api/catalog/settings',
        undefined,
        { errorMessage: 'Failed to load catalog settings.', fallback: { unitPriceDisplayEnabled: true } },
      )
      return result.unitPriceDisplayEnabled !== false
    },
    staleTime: 60_000,
  })

  return {
    enabled: query.data ?? true,
    isLoading: query.isLoading,
  }
}
