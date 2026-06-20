"use client"

import * as React from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ExternalLink, Languages } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
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

  if (!canRender) return null

  return (
    <Drawer open={open} onOpenChange={setOpen}>
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
      <DrawerContent className="max-w-4xl">
        <DrawerHeader>
          <DrawerTitle>
            {t('translations.widgets.translationManager.groupLabel', 'Translations')}
          </DrawerTitle>
          <DrawerDescription>
            {t(
              'translations.widgets.translationManager.groupDescription',
              'Manage translations for this record across supported locales.',
            )}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <TranslationManager
            mode="embedded"
            compact
            entityType={entityType}
            recordId={recordId}
            baseValues={data}
          />
        </DrawerBody>
        {/* Custom footer: 2 inline link affordances (not action buttons),
            wrap-friendly + left-aligned. DS DrawerFooter layouts assume
            buttons in the trailing slot, so we hand-roll the row with
            the DrawerFooter padding convention (`px-6 pt-4 pb-5`). */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-6 pt-4 pb-5">
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
      </DrawerContent>
    </Drawer>
  )
}
