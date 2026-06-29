/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AssignRoleDialog } from '../AssignRoleDialog'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('AssignRoleDialog', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({
      items: [
        {
          userId: 'user-1',
          displayName: 'Ada Lovelace',
          teamName: 'Sales',
          user: { email: 'ada@example.com' },
        },
        {
          userId: 'user-2',
          displayName: 'Grace Hopper',
          teamName: 'Success',
          user: { email: 'grace@example.com' },
        },
      ],
    })
  })

  it('shows conflict badges for already-assigned users when a role is preselected', async () => {
    renderWithProviders(
      <AssignRoleDialog
        open
        onClose={jest.fn()}
        onAssign={jest.fn(async () => undefined)}
        roleTypes={[
          { id: 'rt-1', value: 'account_manager', label: 'Account manager' },
          { id: 'rt-2', value: 'service_owner', label: 'Service owner' },
        ]}
        entityName="Acme Corp"
        initialRoleType="service_owner"
        existingRoleTypes={new Set(['account_manager'])}
        existingAssignments={[
          {
            id: 'role-1',
            roleType: 'account_manager',
            userId: 'user-1',
            userName: 'Ada Lovelace',
            userEmail: 'ada@example.com',
            createdAt: '2026-04-10T10:00:00.000Z',
          },
        ]}
      />,
    )

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenCalled()
    })

    expect(screen.getByText('Service owner')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Conflict: Account manager')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/i }))

    await waitFor(() => {
      expect(screen.getAllByText('Conflict: Account manager').length).toBeGreaterThan(1)
    })
  })

  it('shows a visible load error instead of an empty results state when staff lookup fails', async () => {
    readApiResultOrThrowMock.mockRejectedValueOnce(new Error('Forbidden'))

    renderWithProviders(
      <AssignRoleDialog
        open
        onClose={jest.fn()}
        onAssign={jest.fn(async () => undefined)}
        roleTypes={[
          { id: 'rt-1', value: 'account_manager', label: 'Account manager' },
        ]}
        entityName="Acme Corp"
        initialRoleType="account_manager"
      />,
    )

    await waitFor(() => {
      expect(
        screen.getByText('Unable to load team members. Check your permissions and try again.'),
      ).toBeInTheDocument()
    })
  })

  it('keeps the footer actions available after selecting a user and can load more results', async () => {
    readApiResultOrThrowMock
      .mockResolvedValueOnce({
        items: Array.from({ length: 24 }, (_, index) => ({
          userId: `user-${index + 1}`,
          displayName: `User ${index + 1}`,
          teamName: 'Sales',
          user: { email: `user${index + 1}@example.com` },
        })),
        total: 26,
        page: 1,
        pageSize: 24,
      })
      .mockResolvedValueOnce({
        items: [
          {
            userId: 'user-25',
            displayName: 'User 25',
            teamName: 'Sales',
            user: { email: 'user25@example.com' },
          },
          {
            userId: 'user-26',
            displayName: 'User 26',
            teamName: 'Sales',
            user: { email: 'user26@example.com' },
          },
        ],
        total: 26,
        page: 2,
        pageSize: 24,
      })

    renderWithProviders(
      <AssignRoleDialog
        open
        onClose={jest.fn()}
        onAssign={jest.fn(async () => undefined)}
        roleTypes={[
          { id: 'rt-1', value: 'account_manager', label: 'Account manager' },
        ]}
        entityName="Acme Corp"
        initialRoleType="account_manager"
      />,
    )

    expect(await screen.findByText('Showing 24 of 26 team members')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: /user 1.*user1@example\.com/i,
      }),
    )

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(readApiResultOrThrowMock).toHaveBeenNthCalledWith(
        2,
        '/api/staff/team-members/assignable?page=2&pageSize=24',
        undefined,
      )
    })

    expect(await screen.findByText('Showing 26 of 26 team members')).toBeInTheDocument()
  })

  it('shows "Manage role types" link when canManageRoleTypes is true', () => {
    renderWithProviders(
      <AssignRoleDialog
        open
        onClose={jest.fn()}
        onAssign={jest.fn(async () => undefined)}
        roleTypes={[
          { id: 'rt-1', value: 'account_manager', label: 'Account manager' },
        ]}
        entityName="Acme Corp"
        canManageRoleTypes
      />,
    )

    const link = screen.getByTestId('assign-role-dialog-manage-role-types')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/backend/config/customers')
    expect(link).toHaveTextContent('Manage role types')
  })

  it('hides "Manage role types" link when canManageRoleTypes is false or absent', () => {
    renderWithProviders(
      <AssignRoleDialog
        open
        onClose={jest.fn()}
        onAssign={jest.fn(async () => undefined)}
        roleTypes={[
          { id: 'rt-1', value: 'account_manager', label: 'Account manager' },
        ]}
        entityName="Acme Corp"
      />,
    )

    expect(screen.queryByTestId('assign-role-dialog-manage-role-types')).not.toBeInTheDocument()
    expect(screen.queryByTestId('assign-role-dialog-manage-role-types-step2')).not.toBeInTheDocument()
  })
})
