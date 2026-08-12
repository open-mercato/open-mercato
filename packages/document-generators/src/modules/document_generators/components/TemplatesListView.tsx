'use client'

import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { TemplateListItem } from './TemplateListItem'

interface TemplatesListViewProps {
  templates: TemplateMeta[]
  onSelect: (template: TemplateMeta) => void
}

export function TemplatesListView({ templates, onSelect }: TemplatesListViewProps) {
  return (
    <div className="grid gap-3">
      {templates.map((template) => (
        <TemplateListItem key={template.id} template={template} onClick={onSelect} />
      ))}
    </div>
  )
}
