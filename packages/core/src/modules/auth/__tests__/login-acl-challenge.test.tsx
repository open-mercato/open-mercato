/**
 * @jest-environment jsdom
 *
 * Regression coverage for GH #2070 — the login page must not auto-redirect
 * authenticated users back to a `redirect` URL when the URL carries a
 * `requireFeature` / `requireRole` ACL challenge. Doing so re-triggered the
 * exact 403 that landed the user on /login and produced an infinite loop.
 */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import LoginPage from '../frontend/login'

const mockTranslate = (_key: string, fallback?: string, params?: Record<string, string | number>) => {
  if (!fallback) return _key
  if (!params) return fallback
  return Object.entries(params).reduce(
    (acc, [name, value]) => acc.replace(`{${name}}`, String(value)),
    fallback,
  )
}

const mockReplace = jest.fn()
const mockApiCall = jest.fn()
let currentSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useSearchParams: () => currentSearchParams,
}))

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => <img alt={String(props.alt ?? '')} />,
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>,
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  translateWithFallback: (_t: unknown, _key: string, fallback: string, params?: Record<string, string | number>) =>
    mockTranslate(_key, fallback, params),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@open-mercato/ui/backend/operations/store', () => ({
  clearAllOperations: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/AuthSessionGuard', () => ({
  notifyAuthIdentityChange: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
}))

jest.mock('@open-mercato/ui/backend/injection/useRegisteredComponent', () => ({
  useRegisteredComponent: (_handle: string, Fallback: any) => Fallback,
}))

// Stub fetch so the lookup call from the tenant-resolution effect doesn't blow up.
beforeAll(() => {
  ;(globalThis as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({}), text: async () => '' }))
})

beforeEach(() => {
  jest.clearAllMocks()
  currentSearchParams = new URLSearchParams()
})

describe('LoginPage — ACL challenge redirect-loop guard (#2070)', () => {
  it('does not auto-redirect an authenticated user when requireFeature is in the URL', async () => {
    currentSearchParams = new URLSearchParams({
      requireFeature: 'sales.channels.manage',
      redirect: '/backend/sales/orders',
    })
    mockApiCall.mockResolvedValue({ result: { userId: 'user-employee-1' } })

    await act(async () => {
      render(<LoginPage />)
    })

    // Let the feature-check promise resolve before asserting.
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    // Give any queued microtasks a chance to flush.
    await act(async () => { await Promise.resolve() })

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('does not auto-redirect an authenticated user when requireRole is in the URL', async () => {
    currentSearchParams = new URLSearchParams({
      requireRole: 'admin',
      redirect: '/backend/users',
    })
    mockApiCall.mockResolvedValue({ result: { userId: 'user-employee-1' } })

    await act(async () => {
      render(<LoginPage />)
    })

    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('still auto-redirects an authenticated user with no ACL challenge in the URL', async () => {
    currentSearchParams = new URLSearchParams({ redirect: '/backend/dashboard' })
    mockApiCall.mockResolvedValue({ result: { userId: 'user-admin-1' } })

    await act(async () => {
      render(<LoginPage />)
    })

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/backend/dashboard'))
  })

  it('renders a Return-to-Dashboard affordance when authenticated and an ACL challenge is present', async () => {
    currentSearchParams = new URLSearchParams({
      requireFeature: 'configs.system_status.view',
      redirect: '/backend/config/system-status',
    })
    mockApiCall.mockResolvedValue({ result: { userId: 'user-employee-1' } })

    let rendered: ReturnType<typeof render> | null = null
    await act(async () => {
      rendered = render(<LoginPage />)
    })
    await waitFor(() => expect(mockApiCall).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })

    const link = rendered!.queryByTestId('login-return-dashboard')
    expect(link).not.toBeNull()
    expect(link?.querySelector('a')?.getAttribute('href')).toBe('/backend')
  })
})
