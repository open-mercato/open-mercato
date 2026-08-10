'use client'

import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { TemplatesList } from '@open-mercato/document-generators'

interface OrderWidgetContext {
  kind: string
  resourceId: string
  resourceKind: string
  record: { id: string }
}

/**
 * Renders the PDF template list inside the order detail tab.
 *
 * filter.resourceKind — scopes the list to templates registered for this resource kind.
 *   Passed directly from ctx.resourceKind so the widget works without hardcoding entity names.
 *
 * resource — passed to PreviewPanel so /generate receives resource_kind + resource_id,
 *   enabling logging, event emission, and future PDF history (Phase 5).
 */
export default function OrderPdfTabWidget({ context }: InjectionWidgetComponentProps) {
  const ctx = context as OrderWidgetContext
  const record = ctx?.record

  if (!record) return null

  return (
    <div className="border rounded-lg p-4">
      <TemplatesList
        record={{ id: record.id }}
        filter={{ resourceKind: ctx.resourceKind }}
        resource={{ kind: ctx.resourceKind, id: ctx.resourceId }}
      />
    </div>
  )
}
