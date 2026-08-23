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
            ],
            modules: [{ id: 'checkout', title: 'Checkout' }],
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
          features: [],
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
        },
      },
    )

    expect(await screen.findByText('Kasa')).toBeInTheDocument()
    expect(screen.getByText('Twórz linki i szablony płatności', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('Create checkout links and templates', { exact: false })).not.toBeInTheDocument()
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
})
