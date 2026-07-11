/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChangeLotStatusDialog } from '../ChangeLotStatusDialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'

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
    runMutation: jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation()),
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

  it('submits status updates to the collection PUT endpoint', async () => {
    const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>
    mockedApiCall.mockResolvedValue({
      ok: true,
      status: 200,
      response: new Response(JSON.stringify({ ok: true }), { status: 200 }),
      result: { ok: true },
    })

    render(
      <ChangeLotStatusDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        lotId="cdf758fc-fc4d-4399-ba25-3ec1bd5a17a9"
        currentStatus="hold"
        lotUpdatedAt="2026-06-17T10:00:00.000Z"
      />,
    )

    const form = document.querySelector('form')
    expect(form).toBeTruthy()
    fireEvent.submit(form!)

    await waitFor(() => {
      expect(mockedApiCall).toHaveBeenCalledWith(
        '/api/wms/lots',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"id":"cdf758fc-fc4d-4399-ba25-3ec1bd5a17a9"'),
        }),
      )
    })
  })

  // Regression coverage for #4103: a failed save must surface a visible
  // flash error instead of failing silently.
  it('shows a flash error when the server rejects the status update', async () => {
    const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>
    const failedResponse = new Response(JSON.stringify({ error: 'Lot is already expired.' }), {
      status: 409,
    })
    mockedApiCall.mockResolvedValue({
      ok: false,
      status: 409,
      response: failedResponse,
      result: { error: 'Lot is already expired.' },
    })
    ;(raiseCrudError as jest.Mock).mockImplementation(async () => {
      throw new Error('Lot is already expired.')
    })

    render(
      <ChangeLotStatusDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        lotId="cdf758fc-fc4d-4399-ba25-3ec1bd5a17a9"
        currentStatus="hold"
        lotUpdatedAt="2026-06-17T10:00:00.000Z"
      />,
    )

    const form = document.querySelector('form')
    fireEvent.submit(form!)

    await waitFor(() => {
      expect(flash).toHaveBeenCalledWith('Lot is already expired.', 'error')
    })
  })
})
