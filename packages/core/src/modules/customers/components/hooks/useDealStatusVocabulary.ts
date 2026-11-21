'use client'

import { useQuery } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { z } from 'zod'
import { dealStatusVocabularySchema } from '../../data/dealStatusVocabulary'
import { DEFAULT_DEAL_STATUS_VOCABULARY } from '../../lib/dealStatus'

const dealStatusVocabularyResponseSchema = z.object({
  vocabulary: dealStatusVocabularySchema,
  source: z.enum(['tenant', 'env', 'default']),
  updatedAt: z.string().nullable(),
})

export const dealStatusVocabularyQueryKey = (scopeVersion: number) =>
  ['customers', 'settings', 'deal-status-vocabulary', `scope:${scopeVersion}`] as const

export function useDealStatusVocabulary() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: dealStatusVocabularyQueryKey(scopeVersion),
    staleTime: 60_000,
    placeholderData: undefined,
    queryFn: async ({ signal }) => {
      const payload = await readApiResultOrThrow<unknown>(
        '/api/customers/settings/deal-status-vocabulary',
        { signal },
      )
      return dealStatusVocabularyResponseSchema.parse(payload)
    },
  })

  return {
    vocabulary: query.data?.vocabulary ?? DEFAULT_DEAL_STATUS_VOCABULARY,
    source: query.data?.source ?? 'default',
    updatedAt: query.data?.updatedAt ?? null,
    isLoading: query.isPending,
    isError: query.isError,
    refetch: query.refetch,
  }
}
