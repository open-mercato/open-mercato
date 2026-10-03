"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'

export type TemplateListItemProps = {
  template: TemplateMeta
  onPreview: (template: TemplateMeta) => void
}

export function TemplateListItem({ template, onPreview }: TemplateListItemProps) {
  const t = useT()
  return (
    <li className="flex flex-col gap-3 rounded border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">{template.label}</h3>
        <Badge variant="neutral" className="uppercase">{template.format}</Badge>
      </div>
      {template.description ? <p className="text-xs text-muted-foreground">{template.description}</p> : null}
      <div className="mt-auto">
        <Button type="button" variant="outline" size="sm" onClick={() => onPreview(template)}>
          {t('document_generators.preview.button')}
        </Button>
      </div>
    </li>
  )
}
