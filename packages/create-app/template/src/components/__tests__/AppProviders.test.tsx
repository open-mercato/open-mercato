/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { AppProviders } from '../AppProviders'

let mockPathname = '/login'

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

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
  resolveClientBootstrapProfile: (pathname: string) => pathname.startsWith('/backend') ? 'backend' : 'public',
  ClientBootstrapProvider: ({ children, profile }: { children: React.ReactNode; profile: string }) => (
    <div data-testid="client-bootstrap" data-profile={profile}>{children}</div>
  ),
}))

jest.mock('@/components/ComponentOverridesBootstrap', () => ({
  ComponentOverridesBootstrap: ({ children, profile }: { children: React.ReactNode; profile: string }) => (
    <div data-testid="component-overrides" data-profile={profile}>{children}</div>
  ),
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

  it('passes the pathname-scoped profile to both bootstrap providers', () => {
    mockPathname = '/backend/customers'
    render(
      <AppProviders locale="en" dict={dict} localeLocked={false} demoModeEnabled={true} noticeBarsEnabled={false}>
        <div>content</div>
      </AppProviders>,
    )

    expect(screen.getByTestId('client-bootstrap')).toHaveAttribute('data-profile', 'backend')
    expect(screen.getByTestId('component-overrides')).toHaveAttribute('data-profile', 'backend')
    mockPathname = '/login'
  })
})
