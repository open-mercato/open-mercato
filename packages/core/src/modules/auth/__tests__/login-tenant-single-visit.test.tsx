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
 * What must NOT change: POST /api/auth/login still receives a `tenantId`, which is the
 * disambiguation that path needs when one e-mail address exists in two tenants -
 * `findUsersByEmail` deliberately treats an ambiguous match as no user and falls through
 * to the uniform 401 (issue #2242), and the form has no tenant selector, so with no hint
 * at all such a user has no in-app way back in. The app lands them on a BARE /login
 * routinely: session refresh, logout, and the 401 handler in @open-mercato/ui.
 *
 * So the BANNER is visit-scoped (the defect) while the SUBMITTED value falls back to a
 * per-tab, per-address hint (the disambiguation). sessionStorage removes the 14-day weld
 * and the cross-session surprise; keying on the address removes the other half of the old
 * behaviour's cost - a stale hint narrowing the lookup for a different person on the same
 * tab, who would get a 401 with nothing on screen to explain it.
 */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
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
const HINT_KEY = 'om_login_tenant_hint'
const EMAIL = 'ada@example.com'

async function typeEmail(container: HTMLElement, value: string) {
  const input = container.querySelector('input[name="email"]') as HTMLInputElement
  await act(async () => { fireEvent.change(input, { target: { value } }) })
}

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
  window.sessionStorage.clear()
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

    const clear = screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement
    await act(async () => { clear.click() })

    expect(mockReplace).toHaveBeenCalledWith('/login?redirect=%2Fbackend')
    unmount()
  })

  it('clearing also drops the per-tab hint and expires the onboarding cookie', async () => {
    // "Clear" is the only in-app way to drop `om_login_tenant`, which @open-mercato/
    // onboarding sets server-side for 14 days and reads back as the sole authorization
    // input to its status endpoint.
    document.cookie = `${LEGACY_KEY}=${TENANT_ID}; path=/`
    window.sessionStorage.setItem(HINT_KEY, JSON.stringify({ email: EMAIL, tenantId: TENANT_ID }))

    const { unmount } = await renderLogin(`tenant=${TENANT_ID}`)
    await act(async () => { (screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).click() })

    expect(window.sessionStorage.getItem(HINT_KEY)).toBeNull()
    expect(document.cookie).not.toContain(`${LEGACY_KEY}=${TENANT_ID}`)
    unmount()
  })
})

describe('LoginPage — the submitted tenant survives an in-app bounce, the banner does not', () => {
  it('submits the remembered tenant on a bare /login for the address it was issued to', async () => {
    // The lockout this guards: session refresh / logout / the 401 handler all land a
    // multi-tenant user on a bare /login, where an ambiguous address resolves to no user
    // and returns the uniform 401 with no tenant selector to recover through.
    window.sessionStorage.setItem(HINT_KEY, JSON.stringify({ email: EMAIL, tenantId: TENANT_ID }))

    const { container, unmount } = await renderLogin('')
    await typeEmail(container, EMAIL)

    expect((container.querySelector('input[name="tenantId"]') as HTMLInputElement | null)?.value)
      .toBe(TENANT_ID)
    // ...and the banner still does NOT show, which is the defect this PR is about.
    expect(container.textContent).not.toContain(TENANT_NAME)
    unmount()
  })

  it('ignores the hint for a different address on the same tab', async () => {
    // Without the address key, a second person signing in on this tab would be narrowed
    // to somebody else's tenant and handed the uniform 401 with nothing to explain it.
    window.sessionStorage.setItem(HINT_KEY, JSON.stringify({ email: EMAIL, tenantId: TENANT_ID }))

    const { container, unmount } = await renderLogin('')
    await typeEmail(container, 'someone.else@example.com')

    expect(container.querySelector('input[name="tenantId"]')).toBeNull()
    unmount()
  })

  it('does not resurrect the legacy localStorage entry or cookie', async () => {
    window.localStorage.setItem(LEGACY_KEY, TENANT_ID)
    document.cookie = `${LEGACY_KEY}=${TENANT_ID}; path=/`

    const { container, unmount } = await renderLogin('')
    await typeEmail(container, EMAIL)

    expect(container.querySelector('input[name="tenantId"]')).toBeNull()
    expect(container.textContent).not.toContain(TENANT_NAME)
    unmount()
  })

  it('writes the hint only for this tab, and only on a submit that carried the parameter', async () => {
    const { container, unmount } = await renderLogin(`tenant=${TENANT_ID}`)
    await typeEmail(container, EMAIL)

    // Nothing is written until a sign-in is attempted: /login takes no `email`
    // parameter, so the submit is the first moment both halves are known.
    expect(window.sessionStorage.getItem(HINT_KEY)).toBeNull()

    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => { form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(JSON.parse(window.sessionStorage.getItem(HINT_KEY) || 'null')).toEqual({
      email: EMAIL,
      tenantId: TENANT_ID,
    })
    // Still nothing in localStorage, and no cookie of our own.
    expect(window.localStorage.length).toBe(0)
    unmount()
  })
})
