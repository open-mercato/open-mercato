/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { AppProviders } from '../AppProviders'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/ui', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  FrontendLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="frontend-layout">{children}</div>,
  QueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  AuthFooter: () => <div data-testid="auth-footer" />,
}))

jest.mock('@/components/ClientBootstrap', () => ({
  ClientBootstrapProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@/components/ComponentOverridesBootstrap', () => ({
  ComponentOverridesBootstrap: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@/components/GlobalNoticeBars', () => ({
  GlobalNoticeBars: ({ demoModeEnabled }: { demoModeEnabled: boolean }) => (
    <div data-testid="global-notice-bars" data-demo-mode={demoModeEnabled ? 'true' : 'false'} />
  ),
}))

describe('AppProviders', () => {
  const dict = { test: 'value' }

  it('renders GlobalNoticeBars when notice bars are enabled', () => {
    render(
      <AppProviders locale="en" dict={dict} demoModeEnabled={true} noticeBarsEnabled={true}>
        <div>content</div>
      </AppProviders>,
    )

    expect(screen.getByTestId('global-notice-bars')).toHaveAttribute('data-demo-mode', 'true')
  })

  it('does not render GlobalNoticeBars when notice bars are disabled', () => {
    render(
      <AppProviders locale="en" dict={dict} demoModeEnabled={true} noticeBarsEnabled={false}>
        <div>content</div>
      </AppProviders>,
    )

    expect(screen.queryByTestId('global-notice-bars')).not.toBeInTheDocument()
  })
})
