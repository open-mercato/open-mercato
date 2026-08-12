'use client'

import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { TemplatesList } from '@open-mercato/document-generators/modules/document_generators/components/TemplatesList'

interface OrderWidgetContext {
  kind: string
  resourceKind: string
  record: { id: string }
}

/**
 * Renders the document template list inside the order detail tab.
 *
 * filter.resourceKind — scopes the list to templates registered for this resource kind.
 *   Passed directly from ctx.resourceKind so the widget works without hardcoding entity names.
 *
 * Generation-history identity is derived server-side by the document service.
 */
export default function DocumentGeneratorsOrderTabWidget({ context }: InjectionWidgetComponentProps) {
  const ctx = context as OrderWidgetContext
  const record = ctx?.record

  if (!record) return null

  return (
    <div className="border rounded-lg p-4">
      <TemplatesList
        record={{ id: record.id }}
        filter={{ resourceKind: ctx.resourceKind }}
      />
    </div>
  )
}
