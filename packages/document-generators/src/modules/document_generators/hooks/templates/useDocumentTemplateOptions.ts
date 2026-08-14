'use client'

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { TemplateFilterOptions } from '../../lib/interfaces'

export const documentTemplateOptionsQueryKey = ['document-generators', 'templates', 'options'] as const

export function fetchDocumentTemplateOptions(signal?: AbortSignal) {
  return readApiResultOrThrow<TemplateFilterOptions>(
    '/api/document-generators/templates/options',
    { signal },
    { errorMessage: '[internal] Failed to load document template filter options' },
  )
}

export function useDocumentTemplateOptions() {
  return useQuery({
    queryKey: documentTemplateOptionsQueryKey,
    queryFn: ({ signal }) => fetchDocumentTemplateOptions(signal),
    staleTime: 5 * 60 * 1000,
  })
}
