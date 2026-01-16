import * as React from 'react'
import type { RenderOptions } from '@testing-library/react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

type ProviderOptions = {
  locale?: string
  dict?: Record<string, unknown>
  queryClient?: QueryClient
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: RenderOptions & ProviderOptions,
) {
  const { locale = 'en', dict = {}, queryClient = new QueryClient(), ...rest } = options ?? {}

  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {/* @ts-expect-error shared provider accepts loose dict shape */}
        <I18nProvider locale={locale} dict={dict}>
          {children}
        </I18nProvider>
      </QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Wrapper, ...rest })
}
