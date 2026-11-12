/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ getAll: () => [] }),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const columnsCapture: { current: Array<Record<string, unknown>> | null } = { current: null }
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { columns: Array<Record<string, unknown>> }) => {
    columnsCapture.current = props.columns
    return <div data-testid="data-table-mock" />
  },
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild, ...rest }: any) =>
    asChild ? <span {...rest}>{children}</span> : <button {...rest}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: jest.fn().mockReturnValue(1),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

import UsersListPage from '../page'

const USERS_RESULT = {
  ok: true,
  status: 200,
  result: {
    items: [{
      id: 'user-1',
      email: 'admin@acme.com',
      name: 'Admin',
      organizationId: 'org-1',
      organizationName: 'Acme',
      tenantId: 'tenant-1',
      tenantName: 'Acme Tenant',
      roles: ['admin'],
      isConfirmed: true,
    }],
    total: 1,
    totalPages: 1,
    isSuperAdmin: true,
  },
}

const POLISH_DICT = {
  'auth.users.list.columns.email': 'TEST_PL_EMAIL',
  'auth.users.list.columns.name': 'TEST_PL_NAME',
  'auth.users.list.columns.organization': 'TEST_PL_ORGANIZATION',
  'auth.users.list.columns.roles': 'TEST_PL_ROLES',
  'auth.users.list.columns.status': 'TEST_PL_STATUS',
  'auth.users.list.columns.tenant': 'TEST_PL_TENANT',
}

/**
 * Regression for #5652: the users list rendered `Email`/`Organization`/`Roles`/`Tenant`
 * column headers as raw string literals instead of routing them through `t()`, so they
 * never switched to the active locale even though sibling columns (`name`, `status`) did.
 */
describe('users list page — column header i18n', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    columnsCapture.current = null
    ;(apiCall as jest.Mock).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.startsWith('/api/auth/users?')) {
        return Promise.resolve(USERS_RESULT)
      }
      return Promise.resolve({ ok: true, status: 200, result: { items: [] } })
    })
  })

  it('resolves every column header from the active locale dictionary', async () => {
    renderWithProviders(<UsersListPage />, { locale: 'pl', dict: POLISH_DICT })

    await waitFor(() => {
      const headerByKey = Object.fromEntries(
        (columnsCapture.current ?? []).map((col) => [col.accessorKey as string, col.header]),
      )
      expect(headerByKey.email).toBe('TEST_PL_EMAIL')
      expect(headerByKey.organizationName).toBe('TEST_PL_ORGANIZATION')
      expect(headerByKey.roles).toBe('TEST_PL_ROLES')
      expect(headerByKey.tenantName).toBe('TEST_PL_TENANT')
      expect(headerByKey.name).toBe('TEST_PL_NAME')
    })
  })
})
