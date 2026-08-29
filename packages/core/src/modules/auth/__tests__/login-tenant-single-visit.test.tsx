/**
 * @jest-environment jsdom
 *
 * The `tenant` query parameter on /login is a hint scoped to the CURRENT visit.
 *
 * It used to be mirrored into localStorage['om_login_tenant'] and into a 14-day
 * cookie of the same name, then replayed on every later visit — no TTL of its
 * own, no clear after a successful sign-in. @open-mercato/onboarding puts the
 * parameter on the login link in the workspace-ready e-mail
 * (lib/ready-email.ts), in the post-verification redirect
 * (lib/verify-redirects.ts) and in the onboarding status endpoint's login URL,
 * so every self-serve signup passed through it exactly once and then carried
 * the "you are signing in to <tenant>" banner on /login permanently.
 *
 * What must NOT change: the hidden `tenantId` input still carries the parameter
 * into POST /api/auth/login, which is the disambiguation that path needs when
 * one e-mail address exists in two tenants. And a visit that DOES carry the
 * parameter still resolves the tenant and still reports an unknown one. Only
 * the persistence is gone.
 */
import * as React from 'react'
import { act, render } from '@testing-library/react'
import LoginPage from '../frontend/login'

const mockTranslate = (key: string, fallback?: string, params?: Record<string, string | number>) => {
  if (!fallback) return key
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
  translateWithFallback: (_t: unknown, key: string, fallback: string, params?: Record<string, string | number>) =>
    mockTranslate(key, fallback, params),
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

const TENANT_ID = '2b8a4f16-0d5e-4a2a-9f7c-1c0f0f2a7e11'
const TENANT_NAME = 'Acme Workspace'
const LEGACY_KEY = 'om_login_tenant'

function respondWithTenant(found: boolean) {
  mockApiCall.mockImplementation(async (url: string) => {
    if (String(url).startsWith('/api/directory/tenants/lookup')) {
      return found
        ? { result: { ok: true, tenant: { id: TENANT_ID, name: TENANT_NAME } } }
        : { result: { ok: false, error: 'not_found' } }
    }
    // The authenticated-session probe: an anonymous visitor, so no auto-redirect.
    return { result: {} }
  })
}

async function renderLogin(search: string) {
  currentSearchParams = new URLSearchParams(search)
  let utils: ReturnType<typeof render> | undefined
  await act(async () => {
    utils = render(<LoginPage />)
  })
  // Flush the tenant-lookup promise chain.
  await act(async () => { await Promise.resolve() })
  return utils!
}

beforeAll(() => {
  ;(globalThis as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({}), text: async () => '' }))
})

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  document.cookie = `${LEGACY_KEY}=; path=/; max-age=0`
  respondWithTenant(true)
})

describe('LoginPage — ?tenant= is a single-visit hint', () => {
  it('resolves the tenant for the current visit and submits it', async () => {
    const { container, unmount } = await renderLogin(`tenant=${TENANT_ID}`)

    expect(container.textContent).toContain(TENANT_NAME)
    const hidden = container.querySelector('input[name="tenantId"]') as HTMLInputElement | null
    expect(hidden?.value).toBe(TENANT_ID)
    unmount()
  })

  it('persists the tenant nowhere — not localStorage, not a cookie', async () => {
    const { unmount } = await renderLogin(`tenant=${TENANT_ID}`)

    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull()
    expect(window.localStorage.length).toBe(0)
    expect(document.cookie).not.toContain(LEGACY_KEY)
    unmount()
  })

  it('shows no tenant on a later visit without the parameter, legacy state or not', async () => {
    // Exactly the state a user carried before this change: the localStorage
    // entry written by this component, and the cookie @open-mercato/onboarding
    // also sets server-side on the verification redirect.
    window.localStorage.setItem(LEGACY_KEY, TENANT_ID)
    document.cookie = `${LEGACY_KEY}=${TENANT_ID}; path=/`
    expect(document.cookie).toContain(LEGACY_KEY)

    const { container, unmount } = await renderLogin('')

    expect(container.textContent).not.toContain(TENANT_NAME)
    expect(container.querySelector('input[name="tenantId"]')).toBeNull()
    expect(
      mockApiCall.mock.calls.some(([url]) => String(url).startsWith('/api/directory/tenants/lookup')),
    ).toBe(false)
    unmount()
  })

  it('still reports an unknown tenant when the parameter is present', async () => {
    respondWithTenant(false)

    const { container, unmount } = await renderLogin(`tenant=${TENANT_ID}`)

    expect(container.textContent).toContain('Tenant not found')
    expect(container.textContent).not.toContain(TENANT_NAME)
    expect((container.querySelector('input[name="tenantId"]') as HTMLInputElement | null)?.value)
      .toBe(TENANT_ID)
    unmount()
  })

  it('clearing the tenant drops the parameter from the URL', async () => {
    const { container, unmount } = await renderLogin(`tenant=${TENANT_ID}&redirect=%2Fbackend`)

    const clear = Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim().length > 0 && b.getAttribute('type') === 'button',
    ) as HTMLButtonElement | undefined
    expect(clear).toBeTruthy()
    await act(async () => { clear!.click() })

    expect(mockReplace).toHaveBeenCalledWith('/login?redirect=%2Fbackend')
    unmount()
  })
})
