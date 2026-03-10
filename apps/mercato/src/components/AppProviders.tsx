"use client"

import type { ReactNode } from 'react'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import type { Dict } from '@open-mercato/shared/lib/i18n/context'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { ThemeProvider, FrontendLayout, QueryProvider, AuthFooter } from '@open-mercato/ui'
import { ClientBootstrapProvider } from '@/components/ClientBootstrap'
import { GlobalNoticeBars } from '@/components/GlobalNoticeBars'

type AppProvidersProps = {
  children: ReactNode
  locale: Locale
  dict: Dict
  demoModeEnabled: boolean
}

export function AppProviders({ children, locale, dict, demoModeEnabled }: AppProvidersProps) {
  return (
    <I18nProvider locale={locale} dict={dict}>
      <ClientBootstrapProvider>
        <ThemeProvider>
          <QueryProvider>
            <FrontendLayout footer={<AuthFooter />}>{children}</FrontendLayout>
            <GlobalNoticeBars demoModeEnabled={demoModeEnabled} />
          </QueryProvider>
        </ThemeProvider>
      </ClientBootstrapProvider>
    </I18nProvider>
  )
}
