'use client'

import * as React from 'react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { FlashMessages } from '@open-mercato/ui/backend/FlashMessages'
import { designDictionary } from '@/lib/design-dictionary'
import { DesignSettingsProvider } from './DesignSettings'

export function DocsProviders({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider locale="en" dict={designDictionary} supportedLocales={['en']}>
      <DesignSettingsProvider>
        {children}
        <FlashMessages />
      </DesignSettingsProvider>
    </I18nProvider>
  )
}
