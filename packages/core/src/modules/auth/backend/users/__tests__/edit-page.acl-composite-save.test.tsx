/**
 * @jest-environment jsdom
 *
 * Regression coverage for #8714: the composite user+ACL save used to always
 * re-PUT `auth/users/acl` with whatever the ACL panel last reported, even when
 * the operator never touched it. An org-scoped actor editing a user whose ACL
 * is purely inherited (`organizations: null`) got refused by the scoped-grant
 * check on *every* save — after the primary `auth/users` update had already
 * persisted, leaving the record silently half-saved.
 *
 * `CrudForm` is mocked (as in the sibling activation test) and never actually
 * renders `groups`, so `AclEditor` never mounts either. Instead of mounting
 * it, the `acl` group's `component()` factory is called directly to obtain
 * the `<AclEditor onChange onVersionChange .../>` element, and its props are
 * invoked directly — exactly how the real `AclEditor` calls them on load
 * (`onVersionChange` immediately followed by `onChange`) and on a later edit
 * (`onChange` alone).
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
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ updateCrud: jest.fn(), deleteCrud: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/core/modules/auth/components/AclEditor', () => ({ AclEditor: () => <div>acl</div> }))
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
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'

const updateCrudMock = updateCrud as jest.Mock

function mockUsersResponse(user: Record<string, unknown>) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/auth/users?')) {
      return { ok: true, status: 200, result: { items: [user], isSuperAdmin: false }, response: new Response() }
    }
    return { ok: true, status: 200, result: {}, response: new Response() }
  })
}

function getAclEditorElement(): React.ReactElement<Record<string, any>> {
  const groups = crudFormPropsCapture.current!.groups as Array<Record<string, any>>
  const aclGroup = groups.find((group) => group.id === 'acl')
  const element = aclGroup!.component() as React.ReactElement<Record<string, any>> | null
  if (!element) throw new Error('acl group did not render an AclEditor element')
  return element
}

const baseValues = {
  email: 'admin@acme.com',
  name: 'Admin',
  password: '',
  tenantId: null,
  organizationId: 'org-1',
  roles: [],
  isConfirmed: true,
}

describe('users edit page — composite user+ACL save', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    crudFormPropsCapture.current = null
    mockUsersResponse({ id: 'user-1', email: 'admin@acme.com', roles: [], roleIds: [], isConfirmed: true, updatedAt: '2026-01-01T00:00:00.000Z' })
  })

  it('skips the ACL write entirely when the panel reports the same inherited state it loaded', async () => {
    renderWithProviders(<EditUserPage params={{ id: 'user-1' }} />)

    await waitFor(() => expect(crudFormPropsCapture.current?.onSubmit).toBeTruthy())

    // Simulate the real AclEditor's load sequence: onVersionChange fires
    // immediately before the onChange that reports the loaded (inherited,
    // unrestricted) ACL — see AclEditor.fetchAclState.
    act(() => {
      const acl = getAclEditorElement().props
      acl.onVersionChange(null)
      acl.onChange({ isSuperAdmin: false, features: [], organizations: null })
    })

    updateCrudMock.mockResolvedValue({ ok: true })

    await act(async () => {
      await crudFormPropsCapture.current!.onSubmit(baseValues)
    })

    const calledResources = updateCrudMock.mock.calls.map((call) => call[0])
    expect(calledResources).toContain('auth/users')
    expect(calledResources).not.toContain('auth/users/acl')
  })

  it('writes a touched ACL before the primary user update, and never persists the user update when the ACL write is refused', async () => {
    renderWithProviders(<EditUserPage params={{ id: 'user-1' }} />)

    await waitFor(() => expect(crudFormPropsCapture.current?.onSubmit).toBeTruthy())

    act(() => {
      const acl = getAclEditorElement().props
      acl.onVersionChange(null)
      acl.onChange({ isSuperAdmin: false, features: [], organizations: null })
    })

    // Simulate the operator granting a feature after the initial (inherited) load above.
    act(() => {
      getAclEditorElement().props.onChange({ isSuperAdmin: false, features: ['example.view'], organizations: null })
    })

    const aclForbiddenError = Object.assign(new Error('Cannot grant unrestricted organization access.'), { status: 403 })
    updateCrudMock.mockImplementation(async (resource: string) => {
      if (resource === 'auth/users/acl') throw aclForbiddenError
      return { ok: true }
    })

    await expect(act(async () => {
      await crudFormPropsCapture.current!.onSubmit(baseValues)
    })).rejects.toThrow('Cannot grant unrestricted organization access.')

    const calledResources = updateCrudMock.mock.calls.map((call) => call[0])
    expect(calledResources).toEqual(['auth/users/acl'])
    expect(calledResources).not.toContain('auth/users')
  })
})
