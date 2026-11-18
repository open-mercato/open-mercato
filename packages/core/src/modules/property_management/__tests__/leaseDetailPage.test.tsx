/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LeaseDetailPage } from '../components/leases/LeaseDetailPage'

type CallResult = { ok: boolean; status: number; result: unknown }
const mockApiCall = jest.fn<Promise<CallResult>, [string, RequestInit?, unknown?]>()
const mockSend = jest.fn(async (_request: Record<string, unknown>) => undefined)
const mockConfirmResolvers: Array<(confirmed: boolean) => void> = []

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { grantedFeatures: ['property_management.*'] } }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: () => new Promise<boolean>((resolve) => { mockConfirmResolvers.push(resolve) }),
    ConfirmDialogElement: null,
  }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (url: string, init?: RequestInit, options?: unknown) => mockApiCall(url, init, options),
}))
jest.mock('../components/leases/useLeaseMutation', () => ({ useLeaseMutation: () => ({ send: mockSend }) }))
jest.mock('../components/leases/LeaseSummaryCard', () => ({ LeaseSummaryCard: () => null }))
jest.mock('../components/leases/LeaseBillingAlerts', () => ({ LeaseBillingAlerts: () => null }))
jest.mock('../components/leases/LeaseHistoryCard', () => ({
  LeaseHistoryCard: ({ detail, onWithdraw }: { detail: { proposals: Array<{ id: string }> }; onWithdraw: (proposal: { id: string }) => void }) =>
    detail.proposals.map((proposal) => (
      <button key={proposal.id} type="button" onClick={() => onWithdraw(proposal)}>
        Withdraw proposal
      </button>
    )),
}))
jest.mock('../components/leases/EndLeaseDialog', () => ({ EndLeaseDialog: () => null }))
jest.mock('../components/leases/ExtendLeaseDialog', () => ({ ExtendLeaseDialog: () => null }))
jest.mock('../components/leases/DeleteLeaseDialog', () => ({ DeleteLeaseDialog: () => null }))

const LEASE_ID = '33333333-3333-4333-8333-333333333333'

function leaseDetail(extra: Record<string, unknown>) {
  return {
    lease: {
      id: LEASE_ID, reference: 'L-0001', status: 'active', buildingId: 'b', buildingName: 'HQ', unitId: 'u', unitName: 'U1', floorName: null,
      customerCompanyId: 'c', companyName: 'Acme', primaryContactPersonId: null, contactName: null, startsOn: '2026-01-01', termMonths: 12,
      endsOn: '2026-12-31', daysLeft: 200, productName: 'Office', monthlyRate: '100', currencyCode: 'EUR', salesOrderId: 'order-1',
      salesOrderNumber: 'SO-1', openProposal: null, pendingChange: null, billingPending: false, billingAttention: false,
      unitUnavailable: false, unitUnavailableFrom: null, unitUnavailableUntil: null, updatedAt: '2026-11-01T00:00:00Z',
    },
    leaseEnding: false,
    leaseEndingThresholdDays: 60,
    pendingChange: null,
    lastBillingRefusal: null,
    versions: [],
    proposals: [],
    operations: [],
    billing: { canCredit: false, defaultSettlement: 'keep', cancelAvailable: true },
    ...extra,
  }
}

function respond(detail: CallResult | (() => CallResult)) {
  mockApiCall.mockImplementation(async (url) => {
    if (url.endsWith('/settings')) return { ok: true, status: 200, result: { readOnly: true, proposalExpiryDays: 14, billingChannelConfigured: true } }
    return typeof detail === 'function' ? detail() : detail
  })
}

describe('LeaseDetailPage', () => {
  beforeEach(() => mockApiCall.mockReset())

  it('disables End and Delete with a note while sales cannot cancel recurring orders', async () => {
    respond({ ok: true, status: 200, result: leaseDetail({ salesCancelAvailable: false }) })
    renderWithProviders(<LeaseDetailPage leaseId={LEASE_ID} />)
    expect(await screen.findByTestId('pm-lease-cancel-unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: /End lease/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Delete lease/ })).toBeDisabled()
  })

  it('keeps Delete for a lease with nothing to cancel while sales cannot cancel', async () => {
    const detail = leaseDetail({ salesCancelAvailable: false })
    respond({ ok: true, status: 200, result: { ...detail, lease: { ...detail.lease, status: 'proposed', salesOrderId: null } } })
    renderWithProviders(<LeaseDetailPage leaseId={LEASE_ID} />)
    await screen.findByTestId('pm-lease-cancel-unavailable')
    expect(screen.getByRole('button', { name: /Delete lease/ })).not.toBeDisabled()
  })

  it('treats a missing capability flag as available', async () => {
    respond({ ok: true, status: 200, result: leaseDetail({}) })
    renderWithProviders(<LeaseDetailPage leaseId={LEASE_ID} />)
    const end = await screen.findByRole('button', { name: /End lease/ })
    expect(end).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /Delete lease/ })).not.toBeDisabled()
    expect(screen.queryByTestId('pm-lease-cancel-unavailable')).toBeNull()
  })

  it('shows a deleted lease read-only with a banner and no actions', async () => {
    const detail = leaseDetail({ deleted: true, salesCancelAvailable: false })
    respond({ ok: true, status: 200, result: { ...detail, lease: { ...detail.lease, billingAttention: true } } })
    renderWithProviders(<LeaseDetailPage leaseId={LEASE_ID} />)
    expect(await screen.findByTestId('pm-lease-deleted')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /End lease/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Extend lease/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Delete lease/ })).toBeNull()
    expect(screen.queryByTestId('pm-lease-cancel-unavailable')).toBeNull()
  })

  it('shows a not-found state for a 404', async () => {
    respond({ ok: false, status: 404, result: { error: 'Lease not found.' } })
    renderWithProviders(<LeaseDetailPage leaseId={LEASE_ID} />)
    expect(await screen.findByText('Lease not found')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Back to leases/ })).toHaveAttribute('href', '/backend/property_management/leases')
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull()
  })

  it('offers a retry when the lease cannot be loaded', async () => {
    let calls = 0
    respond(() => {
      calls += 1
      if (calls === 1) throw new Error('network down')
      return { ok: true, status: 200, result: leaseDetail({}) }
    })
    renderWithProviders(<LeaseDetailPage leaseId={LEASE_ID} />)
    fireEvent.click(await screen.findByRole('button', { name: /Try again/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /End lease/ })).toBeTruthy())
  })

  describe('while billing is pending', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('withdraws with the lease version current when the withdrawal is confirmed', async () => {
      mockSend.mockClear()
      mockConfirmResolvers.length = 0
      const proposals = [{ id: 'proposal-1', status: 'sent', kind: 'extension' }]
      const before = leaseDetail({ pendingChange: { kind: 'end', changeId: 'change-1' }, proposals })
      const refreshed = { ...before, lease: { ...before.lease, updatedAt: '2026-11-02T00:00:00Z' } }
      let leaseCalls = 0
      respond(() => {
        leaseCalls += 1
        return { ok: true, status: 200, result: leaseCalls === 1 ? before : refreshed }
      })
      renderWithProviders(<LeaseDetailPage leaseId={LEASE_ID} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Withdraw proposal' }))
      expect(mockConfirmResolvers).toHaveLength(1)

      await act(async () => { jest.advanceTimersByTime(5000) })
      await waitFor(() => expect(leaseCalls).toBe(2))

      await act(async () => { mockConfirmResolvers[0](true) })
      await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1))
      expect(mockSend.mock.calls[0][0]).toMatchObject({ leaseId: LEASE_ID, optimisticLockUpdatedAt: '2026-11-02T00:00:00Z', method: 'DELETE' })
    })

    it('keeps polling after a failed refresh and says the data may be stale', async () => {
      const busy = leaseDetail({ pendingChange: { kind: 'end', changeId: 'change-1' } })
      let leaseCalls = 0
      respond(() => {
        leaseCalls += 1
        if (leaseCalls === 2) return { ok: false, status: 500, result: { error: 'Database unavailable.' } }
        return { ok: true, status: 200, result: busy }
      })
      renderWithProviders(<LeaseDetailPage leaseId={LEASE_ID} />)
      await screen.findByRole('button', { name: /End lease/ })
      expect(leaseCalls).toBe(1)

      await act(async () => { jest.advanceTimersByTime(5000) })
      expect(await screen.findByTestId('pm-lease-refresh-error')).toHaveTextContent('Database unavailable.')
      expect(screen.getByRole('button', { name: /End lease/ })).toBeTruthy()
      expect(leaseCalls).toBe(2)

      await act(async () => { jest.advanceTimersByTime(5000) })
      await waitFor(() => expect(leaseCalls).toBe(3))
      await waitFor(() => expect(screen.queryByTestId('pm-lease-refresh-error')).toBeNull())
    })
  })
})
