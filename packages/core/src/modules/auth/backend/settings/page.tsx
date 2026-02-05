'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function SettingsPage() {
  const t = useT()

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-2">{t('settings.page.title', 'Settings')}</h1>
      <p className="text-muted-foreground mb-6">
        {t('settings.page.description', 'System configuration and administration')}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('settings.page.selectItem', 'Select an item from the menu to configure system settings.')}
      </p>
    </div>
  )
}
