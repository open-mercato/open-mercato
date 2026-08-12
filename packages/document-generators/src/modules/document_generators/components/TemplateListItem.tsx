'use client'

import { FileText } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import type { TemplateMeta } from '@open-mercato/shared/modules/document-generators'

interface TemplateListItemProps {
  template: TemplateMeta
  onClick: (template: TemplateMeta) => void
}

export function TemplateListItem({ template, onClick }: TemplateListItemProps) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => onClick(template)}
      className="h-auto w-full items-start justify-start gap-4 whitespace-normal rounded-lg bg-card p-4 text-left"
    >
      <div className="mt-0.5 rounded-md bg-muted p-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold">{template.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{template.description}</p>
      </div>
    </Button>
  )
}
