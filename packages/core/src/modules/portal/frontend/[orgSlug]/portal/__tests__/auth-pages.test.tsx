/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import PortalLoginPage from '../login/page'
import PortalSignupPage from '../signup/page'

const mockApiCall = jest.fn()

const mockTranslations: Record<string, string> = {
  'portal.login.error.inactive': 'Your account is not active yet. An administrator must activate it before you can log in.',
  'portal.signup.success.description': 'If your registration was accepted, check your email for next steps before signing in. Some organizations require an administrator to activate new accounts.',
  'portal.signup.success.title': 'Check your email',
}

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => mockTranslations[key] ?? fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/ui/portal/PortalContext', () => ({
  usePortalContext: () => ({
    tenant: {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      loading: false,
      error: null,
    },
  }),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/spotIds', () => ({
  PortalInjectionSpots: {
    pageBefore: (pageId: string) => `before:${pageId}`,
    pageAfter: (pageId: string) => `after:${pageId}`,
  },
}))

describe('portal auth pages', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
  })

  it('shows a neutral post-signup message instead of promising immediate login', async () => {
    mockApiCall.mockResolvedValue({
      status: 202,
      ok: true,
      result: {
        ok: true,
      },
    })

    render(<PortalSignupPage params={{ orgSlug: 'acme-corp' }} />)

    fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Jane Smith' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))

    await waitFor(() => {
      expect(screen.getByText(mockTranslations['portal.signup.success.title'])).toBeInTheDocument()
      expect(screen.getByText(mockTranslations['portal.signup.success.description'])).toBeInTheDocument()
    })
    expect(screen.queryByText('Your account has been created. You can now sign in.')).not.toBeInTheDocument()
    expect(screen.queryByText('Your account has been created. You can now log in.')).not.toBeInTheDocument()
  })

  it('surfaces inactive-account login errors instead of showing invalid credentials', async () => {
    mockApiCall.mockResolvedValue({
      status: 401,
      ok: false,
      result: {
        ok: false,
        error: 'Account is deactivated',
      },
    })

    render(<PortalLoginPage params={{ orgSlug: 'acme-corp' }} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => {
      expect(screen.getByText(mockTranslations['portal.login.error.inactive'])).toBeInTheDocument()
    })
    expect(screen.queryByText('Invalid email or password.')).not.toBeInTheDocument()
  })
})
