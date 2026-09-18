/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
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
// i18n is intentionally NOT mocked: renderWithProviders needs the real I18nProvider,
// and the real useT already falls back to the inline default for a missing key.

import EditUserPage from '../[id]/edit/page'

function mockUsersResponse(user: Record<string, unknown>) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('/api/auth/users?')) {
      return { ok: true, status: 200, result: { items: [user], isSuperAdmin: false }, response: new Response() }
    }
    return { ok: true, status: 200, result: {}, response: new Response() }
  })
}

/**
 * The API can deactivate an account (`isConfirmed: false`), which blocks login and
 * revokes every session. Without a control on the form the state is settable but not
 * reachable by an operator, so these guard the toggle's presence and its seeding.
 */
describe('users edit page — account activation control', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    crudFormPropsCapture.current = null
  })

  it('exposes an isConfirmed checkbox in the details group', async () => {
    mockUsersResponse({ id: 'user-1', email: 'admin@acme.com', roles: [], roleIds: [], isConfirmed: true })

    renderWithProviders(<EditUserPage params={{ id: 'user-1' }} />)

    await waitFor(() => expect(crudFormPropsCapture.current?.fields).toBeTruthy())
    const fields = crudFormPropsCapture.current!.fields as Array<Record<string, unknown>>
    const activeField = fields.find((field) => field.id === 'isConfirmed')
    expect(activeField).toMatchObject({ id: 'isConfirmed', type: 'checkbox' })

    const groups = crudFormPropsCapture.current!.groups as Array<Record<string, any>>
    const details = groups.find((group) => group.id === 'details')
    expect(details?.fields).toContain('isConfirmed')
  })

  it('seeds the checkbox from the loaded user so a deactivated account shows as inactive', async () => {
    mockUsersResponse({ id: 'user-1', email: 'admin@acme.com', roles: [], roleIds: [], isConfirmed: false })

    renderWithProviders(<EditUserPage params={{ id: 'user-1' }} />)

    await waitFor(() => expect(crudFormPropsCapture.current?.initialValues?.email).toBe('admin@acme.com'))
    expect(crudFormPropsCapture.current!.initialValues.isConfirmed).toBe(false)
  })

  it('treats a user without the field as active rather than deactivating them', async () => {
    mockUsersResponse({ id: 'user-1', email: 'admin@acme.com', roles: [], roleIds: [] })

    renderWithProviders(<EditUserPage params={{ id: 'user-1' }} />)

    await waitFor(() => expect(crudFormPropsCapture.current?.initialValues?.email).toBe('admin@acme.com'))
    expect(crudFormPropsCapture.current!.initialValues.isConfirmed).toBe(true)
  })
})
