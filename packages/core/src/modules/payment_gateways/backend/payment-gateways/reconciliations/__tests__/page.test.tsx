/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ReconciliationsPage from '../page'

const mockApi = jest.fn()
const mockCreate = jest.fn()
const mockHeaders = jest.fn()
const mockTranslate = (key: string) => key
type Row = { id: string }
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApi(...args),
  withScopedApiRequestHeaders: async (headers: unknown, run: () => Promise<unknown>) => { mockHeaders(headers); return run() },
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: (...args: unknown[]) => mockCreate(...args) }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, PageHeader: () => null,
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: ({ data, onRowClick }: { data: Row[]; onRowClick: (row: Row) => void }) => <div>
  {data.map((row) => <button key={row.id} onClick={() => onRowClick(row)}>{row.id}</button>)}
</div> }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: ({ initialValues, onSubmit }: { initialValues: Record<string, unknown>; onSubmit: (values: Record<string, unknown>) => Promise<void> }) => <button onClick={() => void onSubmit({ ...initialValues, confirmed: true, refundReference: 'fixture', confirmedAt: '2026-01-01T00:00:00.000Z' })}>Submit evidence</button> }))

const required = { id: 'case-fixture', transactionId: 'transaction', providerKey: 'fixture', updatedAt: '2026-01-01T00:00:00.000Z',
  reconciliation: { status: 'required', capturedAmountExact: '100.000000000000000001', currencyCode: 'USD' } }

beforeEach(() => { jest.clearAllMocks(); mockCreate.mockResolvedValue({ ok: true }) })

it('keeps an actionable case visible and sends its own version and exact amount', async () => {
  mockApi.mockResolvedValue({ ok: true, result: { items: [required], total: 1, totalPages: 1 } })
  render(<ReconciliationsPage />)
  fireEvent.click(await screen.findByText(required.id))
  fireEvent.click(screen.getByText('Submit evidence'))
  await waitFor(() => expect(mockCreate).toHaveBeenCalledWith('payment_gateways/reconciliations/case-fixture/resolve', expect.objectContaining({
    refundedAmountExact: '100.000000000000000001', confirmed: true,
  }), expect.anything()))
  expect(mockHeaders).toHaveBeenCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': required.updatedAt })
})

it('surfaces a worklist failure rather than displaying an empty successful result', async () => {
  mockApi.mockResolvedValue({ ok: false, result: null })
  render(<ReconciliationsPage />)
  expect(await screen.findByText('payment_gateways.reconciliation.loadError')).toBeTruthy()
})

it('shows resolved evidence without offering another mutation', async () => {
  mockApi.mockResolvedValue({ ok: true, result: { items: [{ ...required, reconciliation: { ...required.reconciliation, status: 'resolved', resolution: { refundReference: 'settled-refund', actorUserId: 'finance-fixture' } } }], total: 1, totalPages: 1 } })
  render(<ReconciliationsPage />)
  fireEvent.click(await screen.findByText(required.id))
  expect(screen.getByText(/settled-refund/)).toBeTruthy()
  expect(screen.queryByText('Submit evidence')).toBeNull()
})
