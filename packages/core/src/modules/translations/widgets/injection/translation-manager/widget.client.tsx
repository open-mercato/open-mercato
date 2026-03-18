"use client"

import * as React from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ExternalLink, Languages, X } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { TranslationManager } from '../../../components/TranslationManager'
import { extractRecordId } from '../../../lib/extract-record-id'

type WidgetContext = { entityId?: string; recordId?: string }
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
  const [open, setOpen] = React.useState(false)
  const hasAccess = useTranslationAccess()

  const contextRecordId = typeof context?.recordId === 'string' && context.recordId.trim().length > 0
    ? context.recordId.trim()
    : undefined
  const dataRecordId = data?.id === undefined || data.id === null ? undefined : String(data.id)
  const routeRecordId = params ? extractRecordId(params as Record<string, string | string[]>) : undefined
  const recordId = contextRecordId ?? dataRecordId ?? routeRecordId
  const canRender = Boolean(entityType && recordId && hasAccess)

  React.useEffect(() => {
    if (!open || !canRender) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [canRender, open])

  React.useEffect(() => {
    if (!open || !canRender) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [canRender, open])

  if (!canRender) return null

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={t('translations.widgets.translationManager.fullManager', 'Translation manager')}
        title={t('translations.widgets.translationManager.fullManager', 'Translation manager')}
      >
        <Languages className="size-4" />
      </Button>
      {open ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="fixed right-0 top-0 z-50 h-full w-full max-w-4xl border-l bg-background shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-label={t('translations.widgets.translationManager.groupLabel', 'Translations')}
          >
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                <div className="space-y-1">
                  <h2 className="font-semibold">
                    {t('translations.widgets.translationManager.groupLabel', 'Translations')}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {t('translations.widgets.translationManager.groupDescription', 'Manage translations for this record across supported locales.')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(false)}
                  aria-label={t('ui.dialog.close.ariaLabel', 'Close')}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <TranslationManager
                  mode="embedded"
                  compact
                  entityType={entityType}
                  recordId={recordId}
                  baseValues={data}
                />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-4 py-3">
                <Link
                  href={`/backend/entities/system/${encodeURIComponent(entityType!)}`}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Languages className="size-3" />
                  {t('translations.widgets.translationManager.customFieldLabels', 'Custom fields translations')}
                  <ExternalLink className="size-2.5" />
                </Link>
                <Link
                  href="/backend/config/translations"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Languages className="size-3" />
                  {t('translations.widgets.translationManager.fullManager', 'Translation manager')}
                  <ExternalLink className="size-2.5" />
                </Link>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}
