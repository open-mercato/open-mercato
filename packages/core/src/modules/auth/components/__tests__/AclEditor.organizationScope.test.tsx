/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDict from '../../i18n/en.json'

const apiCallMock = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

import { AclEditor, type AclData } from '../AclEditor'

const ORGANIZATIONS = [
  { id: 'org-1', name: 'Warsaw' },
  { id: 'org-2', name: 'Berlin' },
]

function mockApi(aclOrganizations: string[] | null) {
  apiCallMock.mockImplementation(async (url: string) => {
    const ok = { ok: true, status: 200, response: new Response() }
    if (url === '/api/auth/features') {
      return {
        ...ok,
        result: {
          items: [{ id: 'catalog.view', title: 'View catalog', module: 'catalog' }],
          modules: [{ id: 'catalog', title: 'Catalog' }],
        },
      }
    }
    if (url.startsWith('/api/directory/organizations')) {
      return { ...ok, result: { items: ORGANIZATIONS } }
    }
    return {
      ...ok,
      result: {
        hasCustomAcl: true,
        isSuperAdmin: false,
        features: ['catalog.view'],
        organizations: aclOrganizations,
      },
    }
  })
}

function renderEditor(onChange?: (data: AclData) => void) {
  return renderWithProviders(
    <AclEditor
      kind="role"
      targetId="role-1"
      canEditOrganizations
      currentUserIsSuperAdmin
      onChange={onChange}
    />,
    { locale: 'en', dict: enDict },
  )
}

const summary = () => screen.getByTestId('acl-organization-scope-summary').textContent
const denyAllWarning = () => screen.queryByTestId('acl-organization-deny-all-warning')

describe('AclEditor organization scope (#5642)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reports an unrestricted scope and shows no deny-all warning when organizations is null', async () => {
    mockApi(null)
    renderEditor()

    await screen.findByLabelText('Warsaw')

    expect(summary()).toBe(enDict['auth.acl.organizationsScopeCurrent.all'])
    expect(denyAllWarning()).not.toBeInTheDocument()
  })

  it('distinguishes a persisted deny-all scope from the unrestricted one', async () => {
    mockApi([])
    renderEditor()

    await screen.findByLabelText('Warsaw')

    expect(summary()).toBe(enDict['auth.acl.organizationsScopeCurrent.none'])
    expect(summary()).not.toBe(enDict['auth.acl.organizationsScopeCurrent.all'])
    expect(denyAllWarning()).toBeInTheDocument()
  })

  it('warns when unticking the last organization turns the scope into deny-all', async () => {
    mockApi(null)
    const changes: AclData[] = []
    renderEditor((data) => { changes.push(data) })

    const warsaw = await screen.findByLabelText('Warsaw')
    expect(denyAllWarning()).not.toBeInTheDocument()

    fireEvent.click(warsaw)
    await waitFor(() => {
      expect(summary()).toBe('Current scope: 1 selected organization(s).')
    })
    expect(denyAllWarning()).not.toBeInTheDocument()

    fireEvent.click(warsaw)
    await waitFor(() => {
      expect(denyAllWarning()).toBeInTheDocument()
    })
    expect(summary()).toBe(enDict['auth.acl.organizationsScopeCurrent.none'])
    expect(changes.at(-1)?.organizations).toEqual([])
  })

  it('returns to the unrestricted scope through the allow-all control', async () => {
    mockApi([])
    renderEditor()

    await screen.findByLabelText('Warsaw')
    expect(denyAllWarning()).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: enDict['auth.acl.allowAllOrganizations'] }))

    await waitFor(() => {
      expect(summary()).toBe(enDict['auth.acl.organizationsScopeCurrent.all'])
    })
    expect(denyAllWarning()).not.toBeInTheDocument()
  })

  it('does not submit the surrounding form when the allow-all control is used', async () => {
    mockApi([])
    const onSubmit = jest.fn((event: React.FormEvent) => event.preventDefault())
    renderWithProviders(
      <form onSubmit={onSubmit}>
        <AclEditor kind="role" targetId="role-1" canEditOrganizations currentUserIsSuperAdmin />
      </form>,
      { locale: 'en', dict: enDict },
    )

    await screen.findByLabelText('Warsaw')
    const allowAll = screen.getByRole('button', { name: enDict['auth.acl.allowAllOrganizations'] })
    expect(allowAll).toHaveAttribute('type', 'button')

    fireEvent.click(allowAll)

    await waitFor(() => {
      expect(summary()).toBe(enDict['auth.acl.organizationsScopeCurrent.all'])
    })
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps the scope hint from claiming that an empty selection means all organizations', () => {
    expect(enDict['auth.acl.organizationsScopeHint']).not.toMatch(/Empty means all organizations/i)
    expect(enDict['auth.acl.organizationsScopeHint']).toMatch(/denies access to all organizations/i)
  })
})
