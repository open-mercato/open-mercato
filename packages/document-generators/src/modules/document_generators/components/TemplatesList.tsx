"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { useDocumentTemplates, type DocumentTemplatesFilter } from '../hooks/templates/useDocumentTemplates'
import { PreviewPanel } from './PreviewPanel'
import { TemplatesListLoader } from './TemplatesListLoader'
import { TemplatesListView } from './TemplatesListView'

export type TemplatesListProps = {
  record: { id: string }
  filter?: DocumentTemplatesFilter
  onGenerated?: () => void
}

export function TemplatesList({ record, filter, onGenerated }: TemplatesListProps) {
  const t = useT()
  const query = useDocumentTemplates(filter)
  const [selected, setSelected] = React.useState<TemplateMeta | null>(null)
  const templates = query.data ?? []

  if (query.isLoading) return <TemplatesListLoader />
  if (query.isError) return <ErrorMessage label={t('document_generators.templates.error')} />

  return (
    <>
      {templates.length === 0 ? (
        <EmptyState title={t('document_generators.templates.empty')} />
      ) : (
        <TemplatesListView templates={templates} onPreview={setSelected} />
      )}
      {selected ? (
        <PreviewPanel
          template={selected}
          record={record}
          onClose={() => setSelected(null)}
          onGenerated={onGenerated}
        />
      ) : null}
    </>
  )
}
