/** @jest-environment jsdom */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const apiCallMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import { AclEditor } from '../AclEditor'

describe('AclEditor i18n', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/features') {
        return {
          ok: true,
          status: 200,
          response: new Response(),
          result: {
            items: [
              {
                id: 'checkout.create',
                title: 'Create checkout links and templates',
                module: 'checkout',
              },
              {
                id: 'thirdparty.custom',
                title: 'Manage custom integration',
                module: 'thirdparty',
              },
            ],
            modules: [
              { id: 'checkout', title: 'Checkout' },
              { id: 'thirdparty', title: 'Third-party integration' },
            ],
          },
        }
      }
      return {
        ok: true,
        status: 200,
        response: new Response(),
        result: {
          hasCustomAcl: true,
          isSuperAdmin: false,
          features: ['checkout.settings.email.*'],
          organizations: null,
        },
      }
    })
  })

  it('uses catalog translations for module and feature titles', async () => {
    renderWithProviders(
      <AclEditor
        kind="role"
        targetId="role-1"
        canEditOrganizations={false}
        currentUserIsSuperAdmin
      />,
      {
        locale: 'pl',
        dict: {
          'auth.acl.modules.checkout': 'Kasa',
          'auth.acl.features.checkout.create': 'Twórz linki i szablony płatności',
          'auth.acl.wildcards.allGroup': 'Wszystkie uprawnienia w grupie {group}',
        },
      },
    )

    expect(await screen.findByText('Kasa')).toBeInTheDocument()
    expect(screen.getByText('Twórz linki i szablony płatności', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('Create checkout links and templates', { exact: false })).not.toBeInTheDocument()
    expect(screen.getByText('Manage custom integration', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Wszystkie uprawnienia w grupie Settings / Email', { exact: false })).toBeInTheDocument()
  })

  it('uses translations for the super-admin control copy', async () => {
    renderWithProviders(
      <AclEditor
        kind="role"
        targetId="role-1"
        canEditOrganizations={false}
        currentUserIsSuperAdmin={false}
      />,
      {
        locale: 'pl',
        dict: {
          'auth.acl.superAdmin.label': 'Superadministrator (wszystkie uprawnienia)',
          'auth.acl.superAdmin.hint': 'Tylko superadministratorzy mogą zmieniać tę opcję.',
        },
      },
    )

    expect(await screen.findByText('Superadministrator (wszystkie uprawnienia)')).toBeInTheDocument()
    expect(screen.getByText('Tylko superadministratorzy mogą zmieniać tę opcję.')).toBeInTheDocument()
  })

  it('shows assigned roles by their translated labels and keeps the role edit links', async () => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/auth/roles')) {
        return {
          ok: true,
          status: 200,
          response: new Response(),
          result: {
            items: [
              { id: 'role-employee', name: 'employee' },
              { id: 'role-custom', name: 'warehouse_lead' },
            ],
          },
        }
      }
      if (url === '/api/auth/features') {
        return { ok: true, status: 200, response: new Response(), result: { items: [], modules: [] } }
      }
      return {
        ok: true,
        status: 200,
        response: new Response(),
        result: { hasCustomAcl: false, isSuperAdmin: false, features: [], organizations: null },
      }
    })

    renderWithProviders(
      <AclEditor
        kind="user"
        targetId="user-1"
        canEditOrganizations={false}
        userRoles={['employee', 'warehouse_lead']}
      />,
      { locale: 'pl', dict: { 'auth.roles.employee': 'Pracownik' } },
    )

    const translated = await screen.findByRole('link', { name: 'Pracownik' })
    expect(translated).toHaveAttribute('href', '/backend/roles/role-employee/edit')
    expect(screen.getByRole('link', { name: 'warehouse_lead' })).toHaveAttribute('href', '/backend/roles/role-custom/edit')
    expect(screen.queryByRole('link', { name: 'employee' })).not.toBeInTheDocument()
  })
})
