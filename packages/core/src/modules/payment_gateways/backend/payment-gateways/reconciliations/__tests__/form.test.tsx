/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { dismissRecordConflict, getRecordConflictForTest } from '@open-mercato/ui/backend/conflicts'
import dictionary from '../../../../i18n/en.json'
import ReconciliationsPage from '../page'

const mockApi = jest.fn()
const mockCreate = jest.fn()
const mockFlash = jest.fn()
const mockRouter = { push: jest.fn(), refresh: jest.fn() }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter, usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'), apiCall: (...args: unknown[]) => mockApi(...args),
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: (...args: unknown[]) => mockCreate(...args) }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }) }))
jest.mock('@open-mercato/ui/backend/utils/customFieldForms', () => ({
  buildFormFieldsFromCustomFields: () => [], buildFormFieldFromCustomFieldDef: jest.fn(),
  fetchCustomFieldFormStructure: async () => ({ fields: [], definitions: [], metadata: { items: [], fieldsetsByEntity: {}, entitySettings: {} } }),
}))
jest.mock('@open-mercato/ui/backend/Page', () => ({ Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, PageHeader: () => null }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: ({ data, onRowClick }: { data: Array<{ id: string }>; onRowClick: (row: { id: string }) => void }) => <div>{data.map((row) => <button key={row.id} onClick={() => onRowClick(row)}>{row.id}</button>)}</div> }))

const row = { id: 'case-real-form', transactionId: 'transaction', paymentId: 'payment', providerKey: 'fixture', providerSessionId: 'charge-session', gatewayPaymentId: 'charge', parentDeleted: true,
  updatedAt: new Date().toISOString(), reconciliation: { status: 'required', capturedAmountExact: '100', currencyCode: 'USD' } }

beforeEach(() => {
  jest.clearAllMocks()
  dismissRecordConflict()
  mockApi.mockResolvedValue({ ok: true, result: { items: [row], total: 1, totalPages: 1 } })
})

async function showForm() {
  const view = renderWithProviders(<ReconciliationsPage />, { dict: { ...dictionary, 'ui.forms.errors.required': 'Required', 'ui.forms.flash.recordModified': 'Record changed; refresh before retrying.' } })
  fireEvent.click(await screen.findByText(row.id))
  return view
}

async function fillEvidence() {
  fireEvent.change(screen.getByLabelText(/Provider refund reference/), { target: { value: 'fixture-receipt' } })
  fireEvent.change(screen.getByLabelText(/Final settlement time/), { target: { value: new Date(Date.now() - 1000).toISOString() } })
  fireEvent.click(screen.getByRole('checkbox'))
}

it('requires the actual evidence fields and human attestation before submitting', async () => {
  const view = await showForm()
  await act(async () => { fireEvent.submit(view.container.querySelector('form') as HTMLFormElement) })
  expect(mockCreate).not.toHaveBeenCalled()
  expect(await screen.findAllByText('Required')).not.toHaveLength(0)
})

it('retains the form and evidence after a real optimistic conflict without showing success', async () => {
  const conflict = Object.assign(new Error('fixture conflict'), { status: 409, code: 'optimistic_lock_conflict', currentUpdatedAt: new Date(Date.now() + 1000).toISOString(), expectedUpdatedAt: row.updatedAt })
  mockCreate.mockRejectedValue(conflict)
  const view = await showForm()
  await fillEvidence()
  await act(async () => { fireEvent.submit(view.container.querySelector('form') as HTMLFormElement) })
  await waitFor(() => expect(getRecordConflictForTest()).not.toBeNull())
  expect((screen.getByLabelText(/Provider refund reference/) as HTMLInputElement).value).toBe('fixture-receipt')
  expect(mockFlash).not.toHaveBeenCalledWith(expect.anything(), 'success')
})

it('shows a business refusal and keeps the evidence available for correction', async () => {
  mockCreate.mockRejectedValue(new Error('fixture receipt already used'))
  const view = await showForm()
  await fillEvidence()
  await act(async () => { fireEvent.submit(view.container.querySelector('form') as HTMLFormElement) })
  expect(await screen.findByText('fixture receipt already used')).toBeTruthy()
  expect(mockFlash).not.toHaveBeenCalledWith(expect.anything(), 'success')
})
