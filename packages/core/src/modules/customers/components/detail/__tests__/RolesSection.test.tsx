/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { RolesSection } from '../RolesSection'

const readApiResultOrThrowMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const apiCallMock = jest.fn()
const reportErrorMock = jest.fn()
let mockGrantedFeatures: string[]

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({
    reportError: (...args: unknown[]) => reportErrorMock(...args),
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: mockGrantedFeatures },
    isReady: true,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../RoleAssignmentRow', () => ({
  RoleAssignmentRow: ({ role, onChangeUser }: { role: { id: string; userName?: string }; onChangeUser?: () => void }) => (
    <div>
      <span>{role.userName}</span>
      <button type="button" onClick={onChangeUser}>{`change-${role.id}`}</button>
    </div>
  ),
}))

jest.mock('../AssignRoleDialog', () => ({
  AssignRoleDialog: ({
    open,
    roleTypes,
    editingAssignment,
    onAssign,
    onReassign,
  }: {
    open: boolean
    roleTypes: Array<{ value: string; label: string }>
    editingAssignment?: { id: string; roleType: string; userId: string; userName?: string } | null
    onAssign?: (roleType: string, userId: string) => Promise<void>
    onReassign?: (assignmentId: string, userId: string) => Promise<void>
  }) => {
    if (!open) return null
    return (
      <div>
        {roleTypes.map((roleType) => (
          <div key={roleType.value}>{roleType.label}</div>
        ))}
        {editingAssignment ? (
          <>
            <span>{`Currently: ${editingAssignment.userName}`}</span>
            <button
              type="button"
              onClick={() => { onReassign?.(editingAssignment.id, 'user-2').catch(() => undefined) }}
            >
              {`reassign-${editingAssignment.id}`}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => { onAssign?.('account_manager', 'user-2').catch(() => undefined) }}
          >
            create-mode
          </button>
        )}
      </div>
    )
  },
}))

describe('RolesSection', () => {
  beforeEach(() => {
    mockGrantedFeatures = ['customers.roles.view', 'customers.people.view', 'customers.roles.manage', 'customers.settings.manage']
    reportErrorMock.mockReset()
    jest.mocked(flash).mockClear()
    apiCallOrThrowMock.mockReset()
    apiCallOrThrowMock.mockResolvedValue({})
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: false, status: 404, result: null })
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/companies/company-1/roles') {
        return { items: [] }
      }
      if (path === '/api/customers/dictionaries/person-company-roles') {
        return { items: [] }
      }
      return { items: [] }
    })
  })

  it('keeps role assignments readable without exposing create actions to viewers', async () => {
    mockGrantedFeatures = ['customers.roles.view', 'customers.people.view']
    readApiResultOrThrowMock.mockImplementation(async (path: string) => path.endsWith('/roles')
      ? { items: [{ id: 'role-1', roleType: 'decision_maker', userId: 'user-1', userName: 'Employee' }] }
      : { items: [{ id: 'type-1', value: 'account_manager', label: 'Account manager' }] })

    renderWithProviders(<RolesSection entityType="company" entityId="company-1" />)

    expect(await screen.findByText('Employee')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose person' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign role' })).not.toBeInTheDocument()
    expect(apiCallMock).not.toHaveBeenCalled()
  })

  it('resolves all assigned names in one roster request without holding the cards or dialog', async () => {
    mockGrantedFeatures.push('customers.roles.manage')
    readApiResultOrThrowMock.mockResolvedValueOnce({ items: [
      { id: 'role-1', roleType: 'decision_maker', userId: 'user-1', userName: 'Employee' },
      { id: 'role-2', roleType: 'account_manager', userId: 'user-2', userName: 'Admin' },
    ] })
    let finishRoster = () => {}
    apiCallMock.mockReturnValueOnce(new Promise((resolve) => {
      finishRoster = () => resolve({ ok: true, result: { items: [
        { userId: 'other-user', displayName: 'Other person' },
        { userId: 'user-1', displayName: 'Priya Nair' },
        { userId: 'user-2', displayName: 'Marta Lopez' },
      ] } })
    }))

    renderWithProviders(<RolesSection entityType="person" entityId="person-1" />)

    expect(await screen.findByText('Employee')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'change-role-1' }))
    expect(screen.getByText('Currently: Employee')).toBeInTheDocument()

    finishRoster()
    expect(await screen.findByText('Currently: Priya Nair')).toBeInTheDocument()
    expect(screen.getByText('Priya Nair')).toBeInTheDocument()
    expect(screen.getByText('Marta Lopez')).toBeInTheDocument()
    expect(screen.queryByText('Employee')).not.toBeInTheDocument()
    expect(apiCallMock).toHaveBeenCalledTimes(1)
  })

  it('searches only for unmatched assignees when the roster has more than one page', async () => {
    mockGrantedFeatures.push('customers.roles.manage')
    readApiResultOrThrowMock.mockResolvedValueOnce({ items: [
      { id: 'role-1', roleType: 'decision_maker', userId: 'user-1', userEmail: 'employee@example.com' },
      { id: 'role-2', roleType: 'account_manager', userId: 'user-2', userEmail: 'admin@example.com' },
    ] })
    apiCallMock.mockResolvedValueOnce({ ok: true, result: { total: 1000, items: [
      { userId: 'user-1', displayName: 'Priya Nair' },
      ...Array.from({ length: 99 }, (_, index) => ({ userId: `staff-${index}`, displayName: 'Other person' })),
    ] } })
    apiCallMock.mockResolvedValueOnce({ ok: true, result: { items: [
      { userId: 'other-user', displayName: 'Other person' },
      { userId: 'user-2', displayName: 'Marta Lopez' },
    ] } })

    renderWithProviders(<RolesSection entityType="person" entityId="person-1" />)

    expect(await screen.findByText('Marta Lopez')).toBeInTheDocument()
    expect(screen.getByText('Priya Nair')).toBeInTheDocument()
    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(apiCallMock).toHaveBeenLastCalledWith(
      '/api/staff/team-members/assignable?page=1&pageSize=100&search=admin%40example.com',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it.each([404, 403])('keeps the account name when the roster returns %s', async (status) => {
    mockGrantedFeatures.push('customers.roles.manage')
    readApiResultOrThrowMock.mockResolvedValueOnce({ items: [{
      id: 'role-1', roleType: 'decision_maker', userId: 'user-1', userName: 'Employee', userEmail: 'employee@example.com',
    }] })
    apiCallMock.mockResolvedValueOnce({ ok: false, status, result: null })

    renderWithProviders(<RolesSection entityType="person" entityId="person-1" />)

    expect(await screen.findByText('Employee')).toBeInTheDocument()
    expect(apiCallMock).toHaveBeenCalledWith('/api/staff/team-members/assignable?page=1&pageSize=100', expect.objectContaining({
      headers: { 'x-om-forbidden-redirect': '0' },
    }))
    expect(flash).not.toHaveBeenCalled()
  })

  it.each(['company', 'person'] as const)('skips role and dictionary requests without roles view access for a %s', (entityType) => {
    mockGrantedFeatures = ['customers.companies.*', 'customers.people.view']

    const { container } = renderWithProviders(<RolesSection entityType={entityType} entityId="entity-restricted" />)

    expect(container).toBeEmptyDOMElement()
    expect(readApiResultOrThrowMock).not.toHaveBeenCalled()
    expect(flash).not.toHaveBeenCalled()
  })

  it('honors wildcard roles access without requesting a dictionary the viewer cannot read', async () => {
    mockGrantedFeatures = ['customers.companies.view', 'customers.roles.*']

    renderWithProviders(<RolesSection entityType="company" entityId="company-1" entityName="Acme" />)

    expect(await screen.findByText('Roles at Acme')).toBeInTheDocument()
    expect(readApiResultOrThrowMock).toHaveBeenCalledWith('/api/customers/companies/company-1/roles')
    expect(readApiResultOrThrowMock).not.toHaveBeenCalledWith('/api/customers/dictionaries/person-company-roles')
  })

  it('shows a config CTA instead of fallback role types when the dictionary is empty', async () => {
    renderWithProviders(
      <RolesSection
        entityType="company"
        entityId="company-1"
        entityName="Acme Corp"
      />,
    )

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/dictionaries/person-company-roles',
        )
    })

    expect(await screen.findByText('No role types configured')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Configure role types' })[0]).toHaveAttribute(
      'href',
      '/backend/config/customers',
    )
    expect(screen.queryByRole('button', { name: 'Assign role' })).not.toBeInTheDocument()
  })

  it('renders the person-scoped group title "My roles with {name}"', async () => {
    renderWithProviders(
      <RolesSection
        entityType="person"
        entityId="person-1"
        entityName="Sarah Mitchell"
      />,
    )

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalled()
    })

    expect(await screen.findByText('My roles with Sarah Mitchell')).toBeInTheDocument()
  })

  it('renders the company-scoped group title "Roles at {name}"', async () => {
    readApiResultOrThrowMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/companies/company-acme/roles') return { items: [] }
      if (path === '/api/customers/dictionaries/person-company-roles') return { items: [] }
      return { items: [] }
    })

    renderWithProviders(
      <RolesSection
        entityType="company"
        entityId="company-acme"
        entityName="Acme Corp"
      />,
    )

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalled()
    })

    expect(await screen.findByText('Roles at Acme Corp')).toBeInTheDocument()
  })

  it('falls back to a generic name when entityName is absent', async () => {
    renderWithProviders(
      <RolesSection entityType="person" entityId="person-2" />,
    )
    await waitFor(() => expect(readApiResultOrThrowMock).toHaveBeenCalled())
    expect(await screen.findByText('My roles with this person')).toBeInTheDocument()
  })

  function mockRolesAndTypes(roles: Array<{ id: string; roleType: string; userId: string }>) {
    readApiResultOrThrowMock.mockImplementation(async (path: string) => {
      if (path === '/api/customers/companies/company-1/roles') return { items: roles }
      if (path === '/api/customers/dictionaries/person-company-roles') {
        return {
          items: [
            { id: 'rt-1', value: 'account_manager', label: 'Account manager' },
            { id: 'rt-2', value: 'service_owner', label: 'Service owner' },
          ],
        }
      }
      return { items: [] }
    })
  }

  it('offers Assign role only while an unassigned role type remains (#7490)', async () => {
    mockRolesAndTypes([{ id: 'role-1', roleType: 'account_manager', userId: 'user-1' }])
    const { unmount } = renderWithProviders(<RolesSection entityType="company" entityId="company-1" entityName="Acme" />)
    expect(await screen.findByRole('button', { name: 'Assign role' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add role' })).not.toBeInTheDocument()
    unmount()

    mockRolesAndTypes([
      { id: 'role-1', roleType: 'account_manager', userId: 'user-1' },
      { id: 'role-2', roleType: 'service_owner', userId: 'user-2' },
    ])
    renderWithProviders(<RolesSection entityType="company" entityId="company-1" entityName="Acme" />)
    await screen.findByText('change-role-2')
    expect(screen.queryByRole('button', { name: 'Assign role' })).not.toBeInTheDocument()
  })

  it('opens the shared dialog in reassign mode from Change user and saves with PUT (#7490)', async () => {
    mockRolesAndTypes([{ id: 'role-1', roleType: 'account_manager', userId: 'user-1' }])
    renderWithProviders(<RolesSection entityType="company" entityId="company-1" entityName="Acme" />)

    fireEvent.click(await screen.findByText('change-role-1'))
    fireEvent.click(await screen.findByText('reassign-role-1'))

    await waitFor(() => {
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/companies/company-1/roles?roleId=role-1',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ userId: 'user-2' }) }),
      )
    })
    expect(apiCallOrThrowMock).not.toHaveBeenCalledWith(
      '/api/customers/companies/company-1/roles',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('opens the shared dialog in create mode from Assign role (#7490)', async () => {
    mockRolesAndTypes([])
    renderWithProviders(<RolesSection entityType="company" entityId="company-1" entityName="Acme" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Assign role' }))
    expect(await screen.findByText('create-mode')).toBeInTheDocument()
  })

  it('reports a failed assignment to telemetry and still surfaces it to the user (#7490)', async () => {
    const failure = new Error('assign failed')
    apiCallOrThrowMock.mockRejectedValue(failure)
    mockRolesAndTypes([])
    renderWithProviders(<RolesSection entityType="company" entityId="company-1" entityName="Acme" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Assign role' }))
    fireEvent.click(await screen.findByText('create-mode'))

    await waitFor(() => {
      expect(reportErrorMock).toHaveBeenCalledWith(failure, { module: 'customers', code: 'customers.role_assign_failed' })
    })
    expect(flash).toHaveBeenCalledWith('Failed to assign role', 'error')
  })

  it('reports a failed reassignment to telemetry and still surfaces it to the user (#7490)', async () => {
    const failure = new Error('reassign failed')
    apiCallOrThrowMock.mockRejectedValue(failure)
    mockRolesAndTypes([{ id: 'role-1', roleType: 'account_manager', userId: 'user-1' }])
    renderWithProviders(<RolesSection entityType="company" entityId="company-1" entityName="Acme" />)

    fireEvent.click(await screen.findByText('change-role-1'))
    fireEvent.click(await screen.findByText('reassign-role-1'))

    await waitFor(() => {
      expect(reportErrorMock).toHaveBeenCalledWith(failure, { module: 'customers', code: 'customers.role_reassign_failed' })
    })
    expect(flash).toHaveBeenCalledWith('Failed to update role assignment.', 'error')
  })

  it('still flashes the failure when telemetry itself throws (#7490)', async () => {
    reportErrorMock.mockImplementation(() => {
      throw new Error('telemetry unavailable')
    })
    apiCallOrThrowMock.mockRejectedValue(new Error('assign failed'))
    mockRolesAndTypes([])
    renderWithProviders(<RolesSection entityType="company" entityId="company-1" entityName="Acme" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Assign role' }))
    fireEvent.click(await screen.findByText('create-mode'))

    await waitFor(() => {
      expect(flash).toHaveBeenCalledWith('Failed to assign role', 'error')
    })
    expect(reportErrorMock).toHaveBeenCalledTimes(1)
  })
})
