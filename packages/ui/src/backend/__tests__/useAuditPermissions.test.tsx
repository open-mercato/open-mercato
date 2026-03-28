/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAuditPermissions } from '../version-history/useAuditPermissions'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

function Probe() {
  const permissions = useAuditPermissions(true)

  return (
    <div>
      <div data-testid="loading">{permissions.isLoading ? 'yes' : 'no'}</div>
      <div data-testid="view-tenant">{permissions.canViewTenant ? 'yes' : 'no'}</div>
      <div data-testid="undo-tenant">{permissions.canUndoTenant ? 'yes' : 'no'}</div>
      <div data-testid="redo-tenant">{permissions.canRedoTenant ? 'yes' : 'no'}</div>
    </div>
  )
}

describe('useAuditPermissions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('accepts wildcard grants returned by the feature check', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      result: {
        granted: ['audit_logs.*'],
        userId: 'user-1',
      },
    })

    render(<Probe />)

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('no')
    })

    expect(screen.getByTestId('view-tenant').textContent).toBe('yes')
    expect(screen.getByTestId('undo-tenant').textContent).toBe('yes')
    expect(screen.getByTestId('redo-tenant').textContent).toBe('yes')
  })
})
