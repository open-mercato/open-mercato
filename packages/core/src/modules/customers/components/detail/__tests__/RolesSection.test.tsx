/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RolesSection } from '../RolesSection'

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(async () => true),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../RoleAssignmentRow', () => ({
  RoleAssignmentRow: () => null,
}))

jest.mock('../AssignRoleDialog', () => ({
  AssignRoleDialog: ({
    open,
    roleTypes,
  }: {
    open: boolean
    roleTypes: Array<{ value: string; label: string }>
  }) => {
    if (!open) return null
    return (
      <div>
        {roleTypes.map((roleType) => (
          <div key={roleType.value}>{roleType.label}</div>
        ))}
      </div>
    )
  },
}))

describe('RolesSection', () => {
  beforeEach(() => {
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
    expect(screen.queryByRole('button', { name: 'Add role' })).not.toBeInTheDocument()
  })
})
