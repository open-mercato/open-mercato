"use client"

import * as React from 'react'
import { Languages } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@open-mercato/ui/primitives/drawer'
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
            entityType={config!.entityType}
            recordId={config!.recordId}
            baseValues={config!.baseValues}
          />
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}
