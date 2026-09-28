/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RoleAssignmentRow } from '../RoleAssignmentRow'

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(),
    ConfirmDialogElement: null,
  }),
}))

describe('RoleAssignmentRow', () => {
  it('identifies repeated role actions by user and role', () => {
    const commonProps = {
      runMutationWithContext: async <T,>(operation: () => Promise<T>) => operation(),
      entityType: 'person' as const,
      entityId: 'person-1',
      onRemoved: () => {},
      onUpdated: () => {},
    }

    renderWithProviders(
      <>
        <RoleAssignmentRow
          {...commonProps}
          role={{ id: 'role-1', roleType: 'owner', userId: 'user-1', userName: 'Alex Chen', userEmail: 'alex@example.com', userPhone: '+10000000001' }}
          roleTypeLabel="Account owner"
        />
        <RoleAssignmentRow
          {...commonProps}
          role={{ id: 'role-2', roleType: 'advisor', userId: 'user-2', userName: 'Taylor Reed', userEmail: 'taylor@example.com', userPhone: '+10000000002' }}
          roleTypeLabel="Technical advisor"
        />
      </>,
    )

    expect(screen.getByRole('button', { name: 'Remove Account owner role from Alex Chen' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Email Alex Chen' })).toHaveAttribute('href', 'mailto:alex@example.com')
    expect(screen.getByRole('link', { name: 'Call Taylor Reed' })).toHaveAttribute('href', 'tel:+10000000002')
    expect(screen.getByRole('button', { name: 'Change user for Technical advisor' })).toBeInTheDocument()
  })

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
    expect(screen.getByRole('button', { name: 'Change user for Strategic Relationship Owner' })).toHaveClass('w-full')
  })
})
