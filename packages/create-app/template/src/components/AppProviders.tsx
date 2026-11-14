"use client"

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import type { Dict } from '@open-mercato/shared/lib/i18n/context'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import type { ResolvedDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/types'
import { DateLocaleSettingsProvider } from '@open-mercato/ui/primitives/date-locale-settings'
import { ThemeProvider } from '@open-mercato/ui/theme/ThemeProvider'
import { QueryProvider } from '@open-mercato/ui/theme/QueryProvider'
import { FrontendLayout } from '@open-mercato/ui/frontend/Layout'
import { AuthFooter } from '@open-mercato/ui/frontend/AuthFooter'
import { ClientBootstrapProvider, resolveClientBootstrapProfile } from '@/components/ClientBootstrap'
import { GlobalNoticeBars } from '@/components/GlobalNoticeBars'
import { ComponentOverridesBootstrap } from '@/components/ComponentOverridesBootstrap'
import { ContentSecurityPolicyProvider } from '@open-mercato/ui/theme/ContentSecurityPolicyProvider'

type AppProvidersProps = {
  children: ReactNode
  locale: Locale
  dict: Dict
  localeLocked: boolean
  supportedLocales: readonly Locale[]
  dateLocaleSettings?: ResolvedDateLocaleSettings | null
  demoModeEnabled: boolean
  noticeBarsEnabled: boolean
  nonce?: string
}

export function AppProviders({ children, locale, dict, localeLocked, supportedLocales, dateLocaleSettings, demoModeEnabled, noticeBarsEnabled, nonce }: AppProvidersProps) {
  const profile = resolveClientBootstrapProfile(usePathname())
  return (
    <ContentSecurityPolicyProvider nonce={nonce}>
      <I18nProvider locale={locale} dict={dict} localeLocked={localeLocked} supportedLocales={supportedLocales}>
        <DateLocaleSettingsProvider value={dateLocaleSettings}>
          <ClientBootstrapProvider profile={profile}>
            <ComponentOverridesBootstrap profile={profile}>
              <ThemeProvider>
                <QueryProvider>
                  <FrontendLayout footer={<AuthFooter />}>{children}</FrontendLayout>
                  {noticeBarsEnabled ? <GlobalNoticeBars demoModeEnabled={demoModeEnabled} /> : null}
                </QueryProvider>
              </ThemeProvider>
            </ComponentOverridesBootstrap>
          </ClientBootstrapProvider>
        </DateLocaleSettingsProvider>
      </I18nProvider>
    </ContentSecurityPolicyProvider>
  )
}
