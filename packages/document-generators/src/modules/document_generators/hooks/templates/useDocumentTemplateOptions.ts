'use client'

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  DOCUMENT_TEMPLATE_OPTIONS_STALE_TIME_MS,
  DOCUMENT_TEMPLATE_OPTIONS_URL,
  documentTemplateOptionsQueryKey,
} from '../document-queries'

export { documentTemplateOptionsQueryKey }

export type DocumentTemplateOptions = { resourceKinds: string[]; formats: string[] }

export function useDocumentTemplateOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: [...documentTemplateOptionsQueryKey(), scopeVersion],
    staleTime: DOCUMENT_TEMPLATE_OPTIONS_STALE_TIME_MS,
    queryFn: () =>
      readApiResultOrThrow<DocumentTemplateOptions>(DOCUMENT_TEMPLATE_OPTIONS_URL, undefined, {
        errorMessage: '[internal] Failed to load document template options',
      }),
  })
}
