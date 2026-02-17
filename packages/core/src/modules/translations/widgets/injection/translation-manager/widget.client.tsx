"use client"

import * as React from 'react'
import { useParams } from 'next/navigation'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { TranslationManager } from '../../../components/TranslationManager'

type WidgetContext = { entityId?: string }
type WidgetData = Record<string, unknown> & { id?: string | number }

function extractRecordId(params: Record<string, string | string[]>): string | undefined {
  if (params.id) return String(Array.isArray(params.id) ? params.id[0] : params.id)
  for (const [, value] of Object.entries(params)) {
    const segments = Array.isArray(value) ? value : [value]
    for (const seg of segments) {
      if (seg && /^[0-9a-f-]{20,}$/i.test(seg)) return seg
    }
  }
  return undefined
}

export default function TranslationWidget({ context, data }: InjectionWidgetComponentProps<WidgetContext, WidgetData>) {
  const entityType = context?.entityId
  const params = useParams()

  const recordId = React.useMemo(() => {
    if (data?.id) return String(data.id)
    if (params) return extractRecordId(params as Record<string, string | string[]>)
    return undefined
  }, [data?.id, params])

  if (!entityType || !recordId) return null

  return (
    <TranslationManager
      mode="embedded"
      compact
      entityType={entityType}
      recordId={recordId}
      baseValues={data}
    />
  )
}
