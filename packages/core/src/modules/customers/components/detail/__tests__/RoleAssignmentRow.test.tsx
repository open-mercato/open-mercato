/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RoleAssignmentRow } from '../RoleAssignmentRow'

let mockGrantedFeatures: string[] = ['customers.roles.manage']
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: mockGrantedFeatures } }),
  useCurrentOrganization: () => ({ id: 'organization-1' }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(),
    ConfirmDialogElement: null,
  }),
}))

describe('RoleAssignmentRow', () => {
  beforeEach(() => { mockGrantedFeatures = ['customers.roles.manage'] })
  it('keeps long identity values and actions in wrap-safe containers', () => {
    renderWithProviders(
      <RoleAssignmentRow
        role={{
          id: 'role-1',
          roleType: 'account_manager',
          userId: 'user-1',
          userName: 'admin@acme.com',
          userEmail: 'very.long.email.address+with+segments@acme.example.com',
          userPhone: null,
          createdAt: new Date().toISOString(),
        }}
        roleTypeLabel="Strategic Relationship Owner"
        runMutationWithContext={async (operation) => operation()}
        entityType="person"
        entityId="person-1"
        onRemoved={() => {}}
        onUpdated={() => {}}
      />,
    )

    expect(screen.getByText('Strategic Relationship Owner')).toHaveClass('break-words')
    expect(screen.getByText('admin@acme.com')).toHaveClass('break-all')
    expect(screen.getByText('very.long.email.address+with+segments@acme.example.com')).toHaveClass('break-all')
    expect(screen.getByRole('button', { name: 'Change user' })).toHaveClass('w-full')
  })

  it('hands Change user to the host instead of opening the inline lookup when onChangeUser is given (#7490)', () => {
    const onChangeUser = jest.fn()
    renderWithProviders(
      <RoleAssignmentRow
        role={{ id: 'role-1', roleType: 'account_manager', userId: 'user-1', userName: 'Ada Lovelace' }}
        roleTypeLabel="Account manager"
        runMutationWithContext={async (operation) => operation()}
        entityType="company"
        entityId="company-1"
        onRemoved={() => {}}
        onUpdated={() => {}}
        onChangeUser={onChangeUser}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Change user' }))
    expect(onChangeUser).toHaveBeenCalledTimes(1)
    expect(screen.queryByPlaceholderText('Search team member...')).not.toBeInTheDocument()
  })
  it('hides reassignment and removal while preserving identity for a viewer', () => {
    mockGrantedFeatures = ['customers.roles.view']
    renderWithProviders(
      <RoleAssignmentRow
        role={{ id: 'role-1', roleType: 'account_manager', userId: 'user-1', userName: 'Ada Lovelace' }}
        roleTypeLabel="Account manager"
        runMutationWithContext={async (operation) => operation()}
        entityType="company"
        entityId="company-1"
        onRemoved={() => {}}
        onUpdated={() => {}}
      />,
    )
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change user' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove role' })).not.toBeInTheDocument()
  })

})
