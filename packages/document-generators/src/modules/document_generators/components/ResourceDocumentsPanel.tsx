"use client"

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TemplatesList } from './TemplatesList'
import { HistoryList } from './HistoryList'
import { SCOPED_HISTORY_COLUMNS } from './HistoryListTableColumns'

export type ResourceDocumentsPanelProps = {
  resourceKind: string
  resourceId: string
}

export function resourceHistoryQueryKeyPrefix(resourceKind: string, resourceId: string) {
  return ['document-generators', 'history', resourceKind, resourceId] as const
}

export function ResourceDocumentsPanel({ resourceKind, resourceId }: ResourceDocumentsPanelProps) {
  const queryClient = useQueryClient()
  const handleGenerated = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: resourceHistoryQueryKeyPrefix(resourceKind, resourceId) })
  }, [queryClient, resourceKind, resourceId])

  if (!resourceKind || !resourceId) return null

  return (
    <div className="space-y-6">
      <TemplatesList record={{ id: resourceId }} filter={{ resourceKind }} onGenerated={handleGenerated} />
      <HistoryList
        resourceKind={resourceKind}
        resourceId={resourceId}
        columns={SCOPED_HISTORY_COLUMNS}
        pageSize={10}
        showFilters={false}
      />
    </div>
  )
}

export default ResourceDocumentsPanel
