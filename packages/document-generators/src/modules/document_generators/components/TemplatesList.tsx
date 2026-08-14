'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import type { TemplateFilter } from '../lib/interfaces'
import { useDocumentTemplates } from '../hooks/templates/useDocumentTemplates'
import { PreviewPanel } from './PreviewPanel'
import { TemplatesListView } from './TemplatesListView'
import { TemplatesListLoader } from './TemplatesListLoader'

interface TemplatesListProps {
  record: unknown
  filter?: TemplateFilter
}

export function TemplatesList({ record, filter }: TemplatesListProps) {
  const t = useT()
  const [selected, setSelected] = React.useState<TemplateMeta | null>(null)
  const { data: templates = [], isLoading } = useDocumentTemplates(filter)

  if (isLoading) return <TemplatesListLoader />

  return (
    <>
      <h2 className="mb-4 text-sm font-semibold">{t('document_generators.templates.title', 'Available document templates')}</h2>
      <TemplatesListView templates={templates} onSelect={setSelected} />

      {selected && (
        <PreviewPanel
          open={true}
          onClose={() => setSelected(null)}
          record={record}
          template={selected}
        />
      )}
    </>
  )
}
