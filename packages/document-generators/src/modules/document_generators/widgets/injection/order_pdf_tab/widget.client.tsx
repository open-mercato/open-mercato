'use client'

import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { TemplatesList } from '../../../components/TemplatesList'

interface OrderWidgetContext {
  kind: string
  resourceId: string
  resourceKind: string
  record: { id: string }
}

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
