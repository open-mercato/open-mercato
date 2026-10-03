"use client"

import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { TemplateListItem } from './TemplateListItem'

export type TemplatesListViewProps = {
  templates: TemplateMeta[]
  onPreview: (template: TemplateMeta) => void
}

export function TemplatesListView({ templates, onPreview }: TemplatesListViewProps) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {templates.map((template) => (
        <TemplateListItem key={template.id} template={template} onPreview={onPreview} />
      ))}
    </ul>
  )
}
