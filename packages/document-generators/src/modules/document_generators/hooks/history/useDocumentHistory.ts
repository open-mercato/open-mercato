'use client'

import { useQuery } from '@tanstack/react-query'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export interface DocumentHistoryItem {
  id: string
  resourceKind: string
  resourceId: string
  resourceLabel: string
  templateId: string
  templateLabel: string
  format: string
  generatedBy: string
  generatedAt: string
}

export interface DocumentHistoryResponse {
  items: DocumentHistoryItem[]
  total: number
  page: number
  pageSize: number
}

export interface DocumentHistoryQuery {
  page: number
  pageSize: number
  templateId?: string
  generatedBy?: string
  generatedFrom?: string
  generatedTo?: string
  sort: 'resource_label' | 'template_label' | 'format' | 'generated_by' | 'generated_at'
  sortDirection: 'asc' | 'desc'
}

export const documentHistoryQueryKey = (query: DocumentHistoryQuery) => [
  'document-generators',
  'history',
  query,
] as const

export function buildDocumentHistoryUrl(query: DocumentHistoryQuery): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    sort: query.sort,
    sort_direction: query.sortDirection,
  })
  if (query.templateId) params.set('template_id', query.templateId)
  if (query.generatedBy) params.set('generated_by', query.generatedBy)
  if (query.generatedFrom) params.set('generated_from', query.generatedFrom)
  if (query.generatedTo) params.set('generated_to', query.generatedTo)
  return `/api/document-generators/documents?${params.toString()}`
}

export function useDocumentHistory(query: DocumentHistoryQuery) {
  return useQuery({
    queryKey: documentHistoryQueryKey(query),
    queryFn: ({ signal }) => readApiResultOrThrow<DocumentHistoryResponse>(
      buildDocumentHistoryUrl(query),
      { signal },
      { errorMessage: '[internal] Failed to load generation history' },
    ),
  })
}
