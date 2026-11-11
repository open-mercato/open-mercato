"use client"

import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'
import type { Dict } from '@open-mercato/shared/lib/i18n/context'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
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
  demoModeEnabled: boolean
  noticeBarsEnabled: boolean
  nonce?: string
}

export function AppProviders({ children, locale, dict, localeLocked, supportedLocales, demoModeEnabled, noticeBarsEnabled, nonce }: AppProvidersProps) {
  const profile = resolveClientBootstrapProfile(usePathname())
  return (
    <ContentSecurityPolicyProvider nonce={nonce}>
      <I18nProvider locale={locale} dict={dict} localeLocked={localeLocked} supportedLocales={supportedLocales}>
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
      </I18nProvider>
    </ContentSecurityPolicyProvider>
  )
}
