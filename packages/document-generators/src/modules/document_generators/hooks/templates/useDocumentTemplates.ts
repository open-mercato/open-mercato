'use client'

import { useQuery } from '@tanstack/react-query'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { TemplateFilter } from '../../lib/interfaces'

export type DocumentTemplatesQuery = TemplateFilter

export const documentTemplatesQueryKey = ({ resourceKind, documentType, format, tags }: DocumentTemplatesQuery) => [
  'document-generators',
  'templates',
  resourceKind ?? null,
  documentType ?? null,
  format ?? null,
  tags ?? [],
] as const

export function buildDocumentTemplatesUrl({ resourceKind, documentType, format, tags }: DocumentTemplatesQuery): string {
  const params = new URLSearchParams()
  if (resourceKind) params.set('resource_kind', resourceKind)
  if (documentType) params.set('document_type', documentType)
  if (format) params.set('format', format)
  tags?.forEach((tag) => params.append('tags', tag))
  const query = params.toString()
  return `/api/document-generators/templates${query ? `?${query}` : ''}`
}

export function useDocumentTemplates(query: DocumentTemplatesQuery = {}) {
  return useQuery({
    queryKey: documentTemplatesQueryKey(query),
    queryFn: ({ signal }) => readApiResultOrThrow<TemplateMeta[]>(
      buildDocumentTemplatesUrl(query),
      { signal },
      { errorMessage: '[internal] Failed to load document templates' },
    ),
  })
}
