'use client'

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { GeneratedDocumentDto } from '@open-mercato/document-generators/modules/document_generators/services/generation-history-service'
import {
  buildDocumentHistoryUrl,
  documentHistoryQueryKey,
  isDocumentHistoryQueryEnabled,
  type DocumentHistoryQuery,
} from '../document-queries'

export { buildDocumentHistoryUrl, documentHistoryQueryKey }
export type { DocumentHistoryQuery }

export type DocumentHistoryPage = {
  items: GeneratedDocumentDto[]
  total: number
  page: number
  pageSize: number
}

export function useDocumentHistory(query: DocumentHistoryQuery = {}, options: { requireResource?: boolean } = {}) {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: [...documentHistoryQueryKey(query), scopeVersion],
    enabled: isDocumentHistoryQueryEnabled(query, options),
    queryFn: () =>
      readApiResultOrThrow<DocumentHistoryPage>(buildDocumentHistoryUrl(query), undefined, {
        errorMessage: '[internal] Failed to load document history',
      }),
  })
}
