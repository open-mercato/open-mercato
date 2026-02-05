'use client'
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ProfilePage() {
  const t = useT()

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-2">{t('profile.page.title', 'Profile')}</h1>
      <p className="text-muted-foreground mb-6">
        {t('profile.page.description', 'Manage your account settings')}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('profile.page.selectItem', 'Select an item from the menu to manage your account.')}
      </p>
    </div>
  )
}
