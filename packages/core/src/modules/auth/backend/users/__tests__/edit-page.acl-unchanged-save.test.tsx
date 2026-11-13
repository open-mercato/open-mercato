/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const crudFormPropsCapture: { current: Record<string, any> | null } = { current: null }
const apiCallMock = jest.fn()

jest.mock('#generated/entities.ids.generated', () => ({ E: { auth: { user: 'auth:user' } } }), { virtual: true })

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/users/user-1/edit',
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: (props: Record<string, any>) => {
    crudFormPropsCapture.current = props
    return <div>form</div>
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  RecordNotFoundState: () => <div>not-found</div>,
  ErrorMessage: ({ label }: { label?: string }) => <div>{label}</div>,
  LoadingMessage: ({ label }: { label?: string }) => <div>{label}</div>,
}))

const updateCrudMock = jest.fn(async () => ({}))
const deleteCrudMock = jest.fn(async () => ({}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: (...args: unknown[]) => updateCrudMock(...args),
  deleteCrud: (...args: unknown[]) => deleteCrudMock(...args),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

// The 'acl' group's `component()` function is only invoked by this test (the
// mocked CrudForm below never renders `groups`), so the real AclEditor is never
// mounted — only its render is replaced. `isAclDataEqual` stays real since
// page.tsx imports it from the same module.
jest.mock('@open-mercato/core/modules/auth/components/AclEditor', () => {
  const actual = jest.requireActual('@open-mercato/core/modules/auth/components/AclEditor')
  return { ...actual, AclEditor: () => null }
})

jest.mock('@open-mercato/core/modules/auth/components/UserConsentsPanel', () => ({ UserConsentsPanel: () => <div>consents</div> }))
jest.mock('@open-mercato/core/modules/directory/components/OrganizationSelect', () => ({ OrganizationSelect: () => <div>org</div> }))
jest.mock('@open-mercato/core/modules/directory/components/TenantSelect', () => ({ TenantSelect: () => <div>tenant</div> }))
jest.mock('@open-mercato/core/modules/dashboards/components/WidgetVisibilityEditor', () => ({
  WidgetVisibilityEditor: React.forwardRef(function WidgetVisibilityEditor(_props: unknown, _ref: unknown) {
    return <div>widgets</div>
  }),
}))
jest.mock('@open-mercato/core/modules/auth/backend/users/roleOptions', () => ({ fetchRoleOptions: jest.fn(async () => []) }))
jest.mock('@open-mercato/ui/backend/injection/recordContext', () => ({
  buildRecordInjectionContext: () => ({}),
  useSetCurrentRecordInjectionContext: () => undefined,
}))

import EditUserPage from '../[id]/edit/page'

function mockUsersResponse(user: Record<string, unknown>) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/auth/users?')) {
      return { ok: true, status: 200, result: { items: [user], isSuperAdmin: false }, response: new Response() }
    }
    return { ok: true, status: 200, result: {}, response: new Response() }
  })
}

type AclSnapshot = { isSuperAdmin: boolean; features: string[]; organizations: string[] | null }

// Drives the page's `onBaselineChange`/`onChange` callbacks the same way the real
// AclEditor would, by pulling them straight off the element the 'acl' group's
// `component()` constructs — without needing to mount AclEditor itself (the mocked
// CrudForm never renders `groups`, so nothing else would call `component()`).
function driveAclCallbacks(baseline: AclSnapshot, current: AclSnapshot) {
  const aclGroup = (crudFormPropsCapture.current!.groups as Array<Record<string, any>>).find((g) => g.id === 'acl')
  const element = aclGroup!.component()
  act(() => {
    element.props.onBaselineChange(baseline)
    element.props.onChange(current)
  })
}

/**
 * TC-AUTH-8714 [regression]: avoid a partial user save when an unchanged
 * inherited/unrestricted ACL would be refused by the actor's own grant scope (#8714).
 *
 * `onSubmit` always re-sent the loaded ACL snapshot verbatim, even when the operator
 * never touched it, so a scoped editor saving only an unrelated field (e.g. email)
 * could have the primary user write persist and then have the ACL re-submission
 * refused — a partial save. It must now skip the ACL mutation entirely when the
 * current ACL state matches the loaded baseline, and still perform it when it differs.
 */
describe('users edit page — unchanged ACL is not resubmitted on save', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    crudFormPropsCapture.current = null
  })

  it('does not call the ACL update endpoint when the ACL is unchanged from the loaded baseline', async () => {
    mockUsersResponse({ id: 'user-1', email: 'admin@acme.com', roles: [], roleIds: [], isConfirmed: true, updatedAt: '2026-01-01T00:00:00.000Z' })

    renderWithProviders(<EditUserPage params={{ id: 'user-1' }} />)

    await waitFor(() => expect(crudFormPropsCapture.current?.onSubmit).toBeTruthy())

    const baseline: AclSnapshot = { isSuperAdmin: false, features: [], organizations: null }
    driveAclCallbacks(baseline, baseline)

    await act(async () => {
      await crudFormPropsCapture.current!.onSubmit({ email: 'renamed@acme.com', name: 'Admin', roles: [] })
    })

    const aclCalls = updateCrudMock.mock.calls.filter(([resource]) => resource === 'auth/users/acl')
    expect(aclCalls).toHaveLength(0)
    const userCalls = updateCrudMock.mock.calls.filter(([resource]) => resource === 'auth/users')
    expect(userCalls).toHaveLength(1)
  })

  it('still calls the ACL update endpoint when the ACL actually changed', async () => {
    mockUsersResponse({ id: 'user-1', email: 'admin@acme.com', roles: [], roleIds: [], isConfirmed: true, updatedAt: '2026-01-01T00:00:00.000Z' })

    renderWithProviders(<EditUserPage params={{ id: 'user-1' }} />)

    await waitFor(() => expect(crudFormPropsCapture.current?.onSubmit).toBeTruthy())

    const baseline: AclSnapshot = { isSuperAdmin: false, features: [], organizations: null }
    const current: AclSnapshot = { isSuperAdmin: false, features: ['auth.acl.manage'], organizations: null }
    driveAclCallbacks(baseline, current)

    await act(async () => {
      await crudFormPropsCapture.current!.onSubmit({ email: 'admin@acme.com', name: 'Admin', roles: [] })
    })

    const aclCalls = updateCrudMock.mock.calls.filter(([resource]) => resource === 'auth/users/acl')
    expect(aclCalls).toHaveLength(1)
    expect(aclCalls[0][1]).toMatchObject({ userId: 'user-1', features: ['auth.acl.manage'] })
  })

  it('still calls the ACL update endpoint when no baseline was ever reported (fetch failure fallback)', async () => {
    mockUsersResponse({ id: 'user-1', email: 'admin@acme.com', roles: [], roleIds: [], isConfirmed: true, updatedAt: '2026-01-01T00:00:00.000Z' })

    renderWithProviders(<EditUserPage params={{ id: 'user-1' }} />)

    await waitFor(() => expect(crudFormPropsCapture.current?.onSubmit).toBeTruthy())

    await act(async () => {
      await crudFormPropsCapture.current!.onSubmit({ email: 'renamed@acme.com', name: 'Admin', roles: [] })
    })

    const aclCalls = updateCrudMock.mock.calls.filter(([resource]) => resource === 'auth/users/acl')
    expect(aclCalls).toHaveLength(1)
  })

  it('passes a stable onBaselineChange identity across re-renders of the acl group', async () => {
    // `onBaselineChange` must not be a fresh inline function on every page render:
    // AclEditor's data-fetch effect depends on it, so an unstable reference would
    // re-trigger that effect (and refetch the ACL) on every re-render of this page.
    mockUsersResponse({ id: 'user-1', email: 'admin@acme.com', roles: [], roleIds: [], isConfirmed: true, updatedAt: '2026-01-01T00:00:00.000Z' })

    renderWithProviders(<EditUserPage params={{ id: 'user-1' }} />)

    await waitFor(() => expect(crudFormPropsCapture.current?.onSubmit).toBeTruthy())

    const aclGroup = (crudFormPropsCapture.current!.groups as Array<Record<string, any>>).find((g) => g.id === 'acl')
    const firstElement = aclGroup!.component()

    act(() => {
      firstElement.props.onChange({ isSuperAdmin: false, features: ['auth.acl.manage'], organizations: null })
    })
    await waitFor(() => expect(crudFormPropsCapture.current).not.toBe(null))

    const aclGroupAfterRerender = (crudFormPropsCapture.current!.groups as Array<Record<string, any>>).find((g) => g.id === 'acl')
    const secondElement = aclGroupAfterRerender!.component()

    expect(secondElement.props.onBaselineChange).toBe(firstElement.props.onBaselineChange)
  })
})
