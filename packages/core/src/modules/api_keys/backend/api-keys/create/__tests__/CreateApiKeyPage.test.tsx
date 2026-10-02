/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, render, waitFor } from '@testing-library/react'
import CreateApiKeyPage from '../page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchRoleOptions } from '@open-mercato/core/modules/auth/backend/users/roleOptions'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key
const mockPush = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: any) => <div>{children}</div>,
  PageBody: ({ children }: any) => <div>{children}</div>,
}))

type CapturedField = { id: string; loadOptions?: (query?: string) => Promise<unknown> }
let capturedFields: CapturedField[] = []

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: any) => {
    capturedFields = Array.isArray(props.fields) ? props.fields : []
    return <div data-testid="crud-form-mock" />
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  createCrudFormError: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children }: any) => <button>{children}</button>,
}))

jest.mock('@open-mercato/core/modules/directory/components/OrganizationSelect', () => ({
  OrganizationSelect: () => null,
}))

jest.mock('@open-mercato/core/modules/auth/backend/users/roleOptions', () => ({
  fetchRoleOptions: jest.fn(),
}))

// The page reads the announced scope and NOT the scope version — see the effect it
// feeds. `announcedScope` stands in for whatever `useOrganizationScopeDetail()`
// currently holds: seeded from the `om_selected_org` / `om_selected_tenant` cookies
// at module initialisation, then updated on every dispatch.
let announcedScope: { tenantId: string | null; organizationId: string | null } = {
  tenantId: null,
  organizationId: null,
}

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => announcedScope,
  useOrganizationScopeVersion: () => 0,
}))

function findLoadRoleOptions(): ((query?: string) => Promise<unknown>) | undefined {
  const rolesField = capturedFields.find((field) => field.id === 'roles')
  return rolesField?.loadOptions
}

describe('CreateApiKeyPage — role selector tenant scoping (#1556)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedFields = []
    announcedScope = { tenantId: null, organizationId: null }
  })

  it('returns empty options and skips fetchRoleOptions until actor-resolution completes', async () => {
    let resolveActor: (value: any) => void = () => {}
    const actorResolution = new Promise<any>((resolve) => {
      resolveActor = resolve
    })
    ;(apiCall as jest.Mock).mockImplementation(() => actorResolution)
    ;(fetchRoleOptions as jest.Mock).mockResolvedValue([
      { value: 'role-a', label: 'Role A' },
    ])

    render(<CreateApiKeyPage />)

    await waitFor(() => expect(capturedFields.length).toBeGreaterThan(0))

    const loadRoleOptions = findLoadRoleOptions()
    expect(typeof loadRoleOptions).toBe('function')

    // Before the actor-resolution promise settles, the loader MUST return []
    // and MUST NOT invoke fetchRoleOptions — otherwise an unscoped query could
    // leak roles from other tenants when the real caller is a super admin.
    const earlyResult = await loadRoleOptions!()
    expect(earlyResult).toEqual([])
    expect(fetchRoleOptions).not.toHaveBeenCalled()

    // Resolve the actor as a non-super admin. Once the resolution finishes,
    // the loader is allowed to hit the roles endpoint (without tenantId for
    // non-super-admin callers, matching server-side scoping rules).
    await act(async () => {
      resolveActor({ ok: true, result: { tenantId: 'tenant-1', isSuperAdmin: false } })
      await actorResolution
    })

    await waitFor(() => {
      const latest = findLoadRoleOptions()
      expect(latest).not.toBe(loadRoleOptions)
    })

    const resolvedLoader = findLoadRoleOptions()!
    await resolvedLoader()
    expect(fetchRoleOptions).toHaveBeenCalledTimes(1)
    expect(fetchRoleOptions).toHaveBeenCalledWith(undefined)
  })

  it('still blocks the initial call when actor resolution fails (error branch sets actorResolved)', async () => {
    let rejectActor: (reason: unknown) => void = () => {}
    const actorResolution = new Promise<any>((_resolve, reject) => {
      rejectActor = reject
    })
    ;(apiCall as jest.Mock).mockImplementation(() => actorResolution)
    ;(fetchRoleOptions as jest.Mock).mockResolvedValue([])

    render(<CreateApiKeyPage />)

    await waitFor(() => expect(capturedFields.length).toBeGreaterThan(0))

    const earlyLoader = findLoadRoleOptions()!
    expect(await earlyLoader()).toEqual([])
    expect(fetchRoleOptions).not.toHaveBeenCalled()

    await act(async () => {
      rejectActor(new Error('boom'))
      await actorResolution.catch(() => {})
    })

    // After the finally-block flips actorResolved, a fresh loader closure
    // must be produced and the fallback branch is allowed to run.
    await waitFor(() => {
      const latest = findLoadRoleOptions()
      expect(latest).not.toBe(earlyLoader)
    })

    const recoveredLoader = findLoadRoleOptions()!
    await recoveredLoader()
    expect(fetchRoleOptions).toHaveBeenCalledTimes(1)
  })
})

describe('CreateApiKeyPage — tenant sync when the scope version stays 0', () => {
  // The scope version is the cache-busting key behind `useOrganizationScopeVersion()`.
  // It used to reach 1 on every page load, because the module scope started at
  // `{ organizationId: null, tenantId: null }` and the switcher announcing the scope
  // it had just read back from the cookie looked like a change. Now that the module
  // seeds itself from those cookies, an announcement that merely repeats them leaves
  // the version at 0 for the life of the page — so this page must not read
  // `version !== 0` as "the scope is known". It reads the announced scope instead,
  // which is dispatched on the first emission regardless of the version.
  //
  // The mocked `useOrganizationScopeVersion` stays pinned at 0 for exactly that
  // reason: it is the value a repeat visit now produces.
  beforeEach(() => {
    jest.clearAllMocks()
    capturedFields = []
    announcedScope = { tenantId: null, organizationId: null }
  })

  it('scopes the role loader on a repeat visit whose announcement never moves the version', async () => {
    // The reviewer's literal ask: a repeat visit where the version legitimately
    // stays 0. Both sources agree here, which is the ordinary case and is why the
    // old guard's mistake was invisible — `loadInitialScope()` resolves the same
    // tenant a beat later. It is pinned as the baseline the two cases below are read
    // against, not as a regression probe: it passes under the old guard too.
    announcedScope = { tenantId: 'tenant-from-scope', organizationId: 'org-1' }
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, result: { tenantId: 'tenant-from-scope', isSuperAdmin: true } })
    ;(fetchRoleOptions as jest.Mock).mockResolvedValue([{ value: 'role-a', label: 'Role A' }])

    render(<CreateApiKeyPage />)

    await waitFor(() => expect(capturedFields.length).toBeGreaterThan(0))
    await waitFor(() => expect(apiCall).toHaveBeenCalled())

    await act(async () => { await findLoadRoleOptions()!() })

    expect(fetchRoleOptions).toHaveBeenCalledWith(undefined, { tenantId: 'tenant-from-scope' })
  })

  it('follows a scope announced after the endpoint already resolved a tenant', async () => {
    // The case that actually discriminates. A scope announced while the page is
    // mounted — the switcher calls `router.refresh()` rather than navigating, so the
    // component survives it — must reach the role loader on the strength of the
    // announcement alone. With the version pinned at 0, the old
    // `if (scopeVersion === 0) return` guard left the loader scoped to whatever
    // `loadInitialScope()` had resolved, i.e. the previous tenant.
    announcedScope = { tenantId: 'tenant-a', organizationId: 'org-a' }
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, result: { tenantId: 'tenant-a', isSuperAdmin: true } })
    ;(fetchRoleOptions as jest.Mock).mockResolvedValue([{ value: 'role-a', label: 'Role A' }])

    const { rerender } = render(<CreateApiKeyPage />)

    await waitFor(() => expect(capturedFields.length).toBeGreaterThan(0))
    await waitFor(() => expect(apiCall).toHaveBeenCalled())

    const loaderForTenantA = findLoadRoleOptions()!
    announcedScope = { tenantId: 'tenant-b', organizationId: 'org-b' }
    await act(async () => { rerender(<CreateApiKeyPage />) })
    await waitFor(() => expect(findLoadRoleOptions()).not.toBe(loaderForTenantA))

    await act(async () => { await findLoadRoleOptions()!() })

    expect(fetchRoleOptions).toHaveBeenLastCalledWith(undefined, { tenantId: 'tenant-b' })
  })

  it('does not let a pre-announcement null scope clobber the tenant the endpoint resolved', async () => {
    // No selection cookies: the module scope really is `{ null, null }`, and the
    // endpoint is the only source. The scope effect now runs on mount with a null
    // tenant, so this pins that it is a no-op rather than an erasure of what the
    // endpoint resolves a beat later. Like the first case it passes under the old
    // guard too; it is here because dropping that guard is what makes the effect
    // reachable at mount at all, so the no-op has to be asserted rather than assumed.
    announcedScope = { tenantId: null, organizationId: null }
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, result: { tenantId: 'tenant-from-api', isSuperAdmin: true } })
    ;(fetchRoleOptions as jest.Mock).mockResolvedValue([{ value: 'role-a', label: 'Role A' }])

    render(<CreateApiKeyPage />)

    await waitFor(() => expect(capturedFields.length).toBeGreaterThan(0))
    await waitFor(() => expect(apiCall).toHaveBeenCalled())

    await act(async () => { await findLoadRoleOptions()!() })

    expect(fetchRoleOptions).toHaveBeenCalledWith(undefined, { tenantId: 'tenant-from-api' })
  })
})
