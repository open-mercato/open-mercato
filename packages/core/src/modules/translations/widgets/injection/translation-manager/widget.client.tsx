"use client"

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ExternalLink, Languages } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TranslationManager } from '../../../components/TranslationManager'
import { extractRecordId } from '../../../lib/extract-record-id'

type WidgetContext = { entityId?: string }
type WidgetData = Record<string, unknown> & { id?: string | number }

export default function TranslationWidget({ context, data }: InjectionWidgetComponentProps<WidgetContext, WidgetData>) {
  const entityType = context?.entityId
  const params = useParams()
  const t = useT()

  const recordId = React.useMemo(() => {
    if (data?.id) return String(data.id)
    if (params) return extractRecordId(params as Record<string, string | string[]>)
    return undefined
  }, [data?.id, params])

  if (!entityType || !recordId) return null

  return (
    <div className="space-y-3">
      <TranslationManager
        mode="embedded"
        compact
        entityType={entityType}
        recordId={recordId}
        baseValues={data}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3">
        <Link
          href={`/backend/entities/system/${entityType}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Languages className="h-3 w-3" />
          {t('translations.widgets.translationManager.customFieldLabels', 'Custom fields translations')}
          <ExternalLink className="h-2.5 w-2.5" />
        </Link>
        <Link
          href="/backend/config/translations"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Languages className="h-3 w-3" />
          {t('translations.widgets.translationManager.fullManager', 'Translation manager')}
          <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      </div>
    </div>
  )
}
