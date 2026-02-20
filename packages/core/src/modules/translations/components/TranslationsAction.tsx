"use client"

import * as React from 'react'
import { Languages } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { TranslationManager } from './TranslationManager'

export type TranslationsActionConfig = {
  entityType: string
  recordId: string
  baseValues?: Record<string, unknown>
}

export type TranslationsActionProps = {
  config: TranslationsActionConfig | null
}

export function TranslationsAction({ config }: TranslationsActionProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)

  const enabled = Boolean(
    config?.entityType
      && config?.recordId
      && String(config.recordId).trim().length > 0,
  )

  if (!enabled) return null

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={t('translations.action.title', 'Translations')}
        title={t('translations.action.title', 'Translations')}
      >
        <Languages className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('translations.action.dialogTitle', 'Manage translations')}
            </DialogTitle>
            <DialogDescription>
              {t('translations.manager.description', 'Manage translations for entity records across supported locales.')}
            </DialogDescription>
          </DialogHeader>
          <TranslationManager
            mode="embedded"
            entityType={config!.entityType}
            recordId={config!.recordId}
            baseValues={config!.baseValues}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
