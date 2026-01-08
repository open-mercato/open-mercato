"use client"
import { useQuery } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type FeatureToggleItem = {
  identifier: string
  name: string
  description: string
  category: string
  default_state: boolean
  fail_mode: string
}


export function useFeatureToggleItem(id?: string) {
  const t = useT()

  return useQuery({
    queryKey: ['feature_toggles', 'global', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const call = await apiCall<FeatureToggleItem>(
        `/api/feature_toggles/global/${encodeURIComponent(String(id))}`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('feature_toggles.form.errors.load', 'Failed to load feature toggle'))
      }

      return call.result
    },
  })
}
