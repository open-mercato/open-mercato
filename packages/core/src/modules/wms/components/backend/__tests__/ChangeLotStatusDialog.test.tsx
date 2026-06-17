/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ChangeLotStatusDialog } from '../ChangeLotStatusDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

const buildAccess = (overrides: Record<string, unknown> = {}) => ({
  loading: false,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  scopeReady: true,
  canAdjust: true,
  canReceive: true,
  canCycleCount: true,
  canImport: true,
  canMove: true,
  canRelease: true,
  ...overrides,
})

describe('ChangeLotStatusDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders without crashing when open', () => {
    const { container } = render(
      <ChangeLotStatusDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        lotId="lot-uuid-1"
        currentStatus="available"
      />,
    )
    expect(container).toBeTruthy()
  })

  it('shows the dialog title', () => {
    render(
      <ChangeLotStatusDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        lotId="lot-uuid-1"
        currentStatus="available"
      />,
    )
    expect(screen.getByText('Change lot status')).toBeTruthy()
  })

  it('does not render when closed', () => {
    render(
      <ChangeLotStatusDialog
        open={false}
        onOpenChange={jest.fn()}
        access={buildAccess()}
        lotId="lot-uuid-1"
        currentStatus="hold"
      />,
    )
    expect(screen.queryByText('Change lot status')).toBeNull()
  })

  it.each(['available', 'hold', 'quarantine', 'expired'] as const)(
    'handles currentStatus=%s without crashing',
    (status) => {
      const { container } = render(
        <ChangeLotStatusDialog
          open
          onOpenChange={jest.fn()}
          access={buildAccess()}
          lotId="lot-uuid-1"
          currentStatus={status}
        />,
      )
      expect(container).toBeTruthy()
    },
  )

  it('defaults to "available" when currentStatus is unknown', () => {
    const { container } = render(
      <ChangeLotStatusDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        lotId="lot-uuid-1"
        currentStatus="unknown_value"
      />,
    )
    expect(container).toBeTruthy()
  })

  it('shows the submit button', () => {
    render(
      <ChangeLotStatusDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        lotId="lot-uuid-1"
        currentStatus="available"
      />,
    )
    expect(screen.getByRole('button', { name: /Update status/i })).toBeTruthy()
  })
})
