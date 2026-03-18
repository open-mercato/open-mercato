"use client"

import * as React from 'react'
import { Languages, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TranslationManager } from './TranslationManager'

export type TranslationDrawerActionConfig = {
  entityType: string
  recordId: string
  baseValues?: Record<string, unknown>
}

export type TranslationDrawerActionProps = {
  config: TranslationDrawerActionConfig | null
}

export function TranslationDrawerAction({ config }: TranslationDrawerActionProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const canRender = Boolean(
    config?.entityType && config?.recordId && String(config.recordId).trim().length > 0,
  )

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
                  entityType={config!.entityType}
                  recordId={config!.recordId}
                  baseValues={config!.baseValues}
                />
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}
