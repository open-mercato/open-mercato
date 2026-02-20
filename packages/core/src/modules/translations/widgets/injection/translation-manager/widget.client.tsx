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

function useTranslationAccess(): boolean {
  const [hasAccess, setHasAccess] = React.useState(false)
  React.useEffect(() => {
    let mounted = true
    // Use the original fetch to bypass the global apiFetch wrapper
    // that redirects to login on 403. This lets us gracefully hide the widget
    // when the user lacks translations.view instead of crashing the page.
    const nativeFetch = ((window as any).__omOriginalFetch as typeof fetch) || fetch
    nativeFetch('/api/translations/locales', { credentials: 'include' })
      .then((res) => { if (mounted) setHasAccess(res.ok) })
      .catch(() => { if (mounted) setHasAccess(false) })
    return () => { mounted = false }
  }, [])
  return hasAccess
}

export default function TranslationWidget({ context, data }: InjectionWidgetComponentProps<WidgetContext, WidgetData>) {
  const entityType = context?.entityId
  const params = useParams()
  const t = useT()
  const hasAccess = useTranslationAccess()

  const recordId = React.useMemo(() => {
    if (data?.id) return String(data.id)
    if (params) return extractRecordId(params as Record<string, string | string[]>)
    return undefined
  }, [data?.id, params])

  if (!entityType || !recordId || !hasAccess) return null

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
