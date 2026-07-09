/**
 * @jest-environment jsdom
 *
 * Regression coverage for GH #3128 — clicking "Clear" on the login tenant
 * banner deletes the `tenant` query param and navigates, which used to change
 * the `searchParams` object the mount feature-check effect depended on, firing
 * a second (401) POST /api/auth/feature-check. The effect must only depend on
 * the `redirect` param it actually reads, so unrelated query-param changes do
 * not re-trigger the auth probe.
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
const mockPush = jest.fn()
// Next's useRouter returns a stable reference across renders; mirror that so the
// effect's dependency array isn't invalidated by an unrelated new router object.
const mockRouter = { replace: mockReplace, push: mockPush }
const mockApiCall = jest.fn()
let currentSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
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

beforeAll(() => {
  ;(globalThis as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({}), text: async () => '' }))
})

beforeEach(() => {
  jest.clearAllMocks()
  currentSearchParams = new URLSearchParams()
  window.localStorage.clear()
  mockApiCall.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/directory/tenants/lookup')) {
      return { result: { ok: true, tenant: { id: 'tenant-1', name: 'Acme Tenant' } } }
    }
    // Unauthenticated visitor: feature-check returns no userId.
    return { result: {} }
  })
})

const featureCheckCalls = () =>
  mockApiCall.mock.calls.filter(([url]) => url === '/api/auth/feature-check').length

describe('LoginPage — feature-check fires once (#3128)', () => {
  it('does not re-issue POST /api/auth/feature-check when the tenant param is cleared', async () => {
    currentSearchParams = new URLSearchParams({ redirect: '/backend', tenant: 'tenant-1' })

    let rerender: (ui: React.ReactElement) => void
    await act(async () => {
      const view = render(<LoginPage />)
      rerender = view.rerender
    })
    await waitFor(() => expect(featureCheckCalls()).toBe(1))

    // Simulate "Clear": the tenant param is removed, the rest of the URL is unchanged.
    currentSearchParams = new URLSearchParams({ redirect: '/backend' })
    await act(async () => {
      rerender(<LoginPage />)
      await Promise.resolve()
    })

    expect(featureCheckCalls()).toBe(1)
  })
})
