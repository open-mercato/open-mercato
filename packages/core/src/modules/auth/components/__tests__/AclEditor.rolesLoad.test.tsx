/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
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

const ok = (result: unknown) => ({ ok: true, status: 200, response: new Response(), result })
const failed = { ok: false, status: 503, response: new Response(), result: null }

describe('AclEditor assigned roles loading', () => {
  let rolesResponses: Array<() => Promise<unknown>>

  beforeEach(() => {
    jest.clearAllMocks()
    rolesResponses = []
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/auth/roles')) {
        const next = rolesResponses.shift()
        if (!next) throw new Error('[internal] unexpected roles request')
        return next()
      }
      if (url === '/api/auth/features') return ok({ items: [], modules: [] })
      return ok({ hasCustomAcl: false, isSuperAdmin: false, features: [], organizations: null })
    })
  })

  function renderEditor() {
    return renderWithProviders(
      <AclEditor kind="user" targetId="user-1" canEditOrganizations={false} userRoles={['employee']} />,
      { locale: 'en', dict: {} },
    )
  }

  it.each([
    ['an error response', async () => failed],
    ['a network failure', async () => { throw new TypeError('Failed to fetch') }],
  ])('tells the user the roles could not be loaded after %s and recovers on retry', async (_label, failure) => {
    rolesResponses.push(failure, async () => ok({ items: [{ id: 'role-employee', name: 'employee' }] }))
    renderEditor()

    expect(await screen.findByRole('alert')).toHaveTextContent('Assigned roles could not be loaded.')
    expect(screen.queryByRole('link', { name: 'employee' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('link', { name: 'employee' })).toHaveAttribute('href', '/backend/roles/role-employee/edit')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no error when the roles load', async () => {
    rolesResponses.push(async () => ok({ items: [{ id: 'role-employee', name: 'employee' }] }))
    renderEditor()

    expect(await screen.findByRole('link', { name: 'employee' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
