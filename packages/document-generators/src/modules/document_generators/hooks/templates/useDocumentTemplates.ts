'use client'

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import {
  buildDocumentTemplatesUrl,
  documentTemplatesQueryKey,
  type DocumentTemplatesFilter,
} from '../document-queries'

export { buildDocumentTemplatesUrl, documentTemplatesQueryKey }
export type { DocumentTemplatesFilter }

export function useDocumentTemplates(filter: DocumentTemplatesFilter = {}) {
  const scopeVersion = useOrganizationScopeVersion()
  return useQuery({
    queryKey: [...documentTemplatesQueryKey(filter), scopeVersion],
    queryFn: () =>
      readApiResultOrThrow<TemplateMeta[]>(buildDocumentTemplatesUrl(filter), undefined, {
        errorMessage: '[internal] Failed to load document templates',
      }),
  })
}
