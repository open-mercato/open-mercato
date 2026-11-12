/**
 * @jest-environment jsdom
 */
// #8268 review Major 13 / N1 / N2. These drive the REAL `CrudForm` rendered inside the
// REAL edit/adjust dialogs — not a mocked form capturing `onSubmit` — so the assertions
// exercise the actual DOM input parsing CrudForm performs before `credit-panel.tsx`'s own
// client validation ever sees a value. `Dialog`/`DialogContent` are the only mocked
// pieces (thin passthroughs — Radix's portal/focus-trap machinery adds nothing jsdom can
// usefully verify here); everything else, including `CrudForm`, is the real component.

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { CreditPanelWidget } from '../credit-panel'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/apiCall'),
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/utils/crud'),
  createCrud: jest.fn(),
  updateCrud: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: ['customer_groups.credit.manage', 'customer_groups.credit.adjust'] },
    isReady: true,
  }),
}))
jest.mock('@open-mercato/ui/primitives/dialog', () => {
  const React = require('react')
  return {
    Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => (open ? <div>{children}</div> : null),
    DialogContent: React.forwardRef(function DialogContent(
      { children, onKeyDown }: { children: React.ReactNode; onKeyDown?: (e: React.KeyboardEvent) => void },
      ref: React.Ref<HTMLDivElement>,
    ) {
      return (
        <div ref={ref} onKeyDown={onKeyDown}>
          {children}
        </div>
      )
    }),
    DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }
})

const apiCallMock = jest.mocked(apiCall)
const apiCallOrThrowMock = jest.mocked(apiCallOrThrow)
const updateCrudMock = jest.mocked(updateCrud)

const ACCOUNT_ROW = {
  id: 'account-1',
  customerId: 'person-1',
  currencyCode: 'USD',
  creditLimit: '100.00',
  isOnHold: false,
  holdReason: null,
  exposure: '0.00',
  available: '100.00',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function mockAccountsList(rows: Array<Record<string, unknown>> = [ACCOUNT_ROW]) {
  apiCallMock.mockImplementation(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/credit-accounts?')) {
      return { ok: true, status: 200, result: { items: rows }, response: {} as Response }
    }
    if (url.includes('/ledger')) {
      return { ok: true, status: 200, result: { items: [], page: 1, pageSize: 20, total: 0 }, response: {} as Response }
    }
    return { ok: true, status: 200, result: null, response: {} as Response }
  })
}

async function renderPanel() {
  const utils = renderWithProviders(<CreditPanelWidget context={{ resourceKind: 'customers.person', resourceId: 'person-1' }} />)
  await waitFor(() => expect(screen.getByText('USD')).toBeInTheDocument())
  return utils
}

async function openEditDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit credit account' }))
  return screen.findByRole('button', { name: 'Save' })
}

async function openAdjustDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Adjust' }))
  return screen.findByRole('button', { name: 'Post adjustment' })
}

describe('CreditPanelWidget edit dialog — limit validation (#8268 review Major 13)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAccountsList()
  })

  it('keeps the dialog open with a field error when the limit is left empty, and never calls updateCrud', async () => {
    await renderPanel()
    const saveButton = await openEditDialog()

    const limitInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(limitInput, { target: { value: '' } })
    fireEvent.click(saveButton)

    await screen.findByText('Enter a limit of zero or more.')
    expect(updateCrudMock).not.toHaveBeenCalled()
    // The dialog is still open — its Save button is still on screen.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('keeps the dialog open with a field error when the limit is not a number, and never calls updateCrud', async () => {
    await renderPanel()
    const saveButton = await openEditDialog()

    const limitInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(limitInput, { target: { value: 'abc' } })
    fireEvent.click(saveButton)

    await screen.findByText('Enter a limit of zero or more.')
    expect(updateCrudMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('accepts a valid zero limit and submits it', async () => {
    updateCrudMock.mockResolvedValue({ result: { id: 'account-1' }, response: {} as Response } as never)
    await renderPanel()
    const saveButton = await openEditDialog()

    const limitInput = screen.getAllByRole('textbox')[0]
    fireEvent.change(limitInput, { target: { value: '0' } })
    fireEvent.click(saveButton)

    await waitFor(() => expect(updateCrudMock).toHaveBeenCalledTimes(1))
    expect(updateCrudMock).toHaveBeenCalledWith(
      'customer_groups/customer-groups/credit-accounts',
      expect.objectContaining({ id: 'account-1', creditLimit: 0 }),
      expect.anything(),
    )
  })
})

describe('CreditPanelWidget adjust dialog — locale amount parsing (#8268 review N1)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAccountsList()
    apiCallOrThrowMock.mockResolvedValue({ result: { ok: true }, response: {} as Response } as never)
  })

  async function submitAdjustAmount(rawAmount: string, note = 'payment received') {
    await renderPanel()
    const postButton = await openAdjustDialog()
    const [amountInput, noteInput] = screen.getAllByRole('textbox')
    fireEvent.change(amountInput, { target: { value: rawAmount } })
    fireEvent.change(noteInput, { target: { value: note } })
    fireEvent.click(postButton)
    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1))
    const [, init] = apiCallOrThrowMock.mock.calls[0]
    return JSON.parse(String((init as RequestInit).body))
  }

  it('normalizes a Polish-locale comma-decimal positive amount to a dot-decimal string', async () => {
    const body = await submitAdjustAmount('12,50')
    expect(body).toEqual({ amount: '12.50', note: 'payment received' })
  })

  it('normalizes a Polish-locale comma-decimal negative amount to a dot-decimal string', async () => {
    const body = await submitAdjustAmount('-12,50')
    expect(body).toEqual({ amount: '-12.50', note: 'payment received' })
  })

  it('still accepts a plain dot-decimal amount unchanged', async () => {
    const body = await submitAdjustAmount('12.50')
    expect(body).toEqual({ amount: '12.50', note: 'payment received' })
  })

  it('still rejects a zero amount and never calls the adjust endpoint', async () => {
    await renderPanel()
    const postButton = await openAdjustDialog()
    const [amountInput, noteInput] = screen.getAllByRole('textbox')
    fireEvent.change(amountInput, { target: { value: '0' } })
    fireEvent.change(noteInput, { target: { value: 'note' } })
    fireEvent.click(postButton)

    await screen.findByText('Enter a signed amount with up to 2 decimal places (not zero).')
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })

  it('still rejects more than 2 fraction digits instead of silently rounding', async () => {
    await renderPanel()
    const postButton = await openAdjustDialog()
    const [amountInput, noteInput] = screen.getAllByRole('textbox')
    fireEvent.change(amountInput, { target: { value: '12,505' } })
    fireEvent.change(noteInput, { target: { value: 'note' } })
    fireEvent.click(postButton)

    await screen.findByText('Enter a signed amount with up to 2 decimal places (not zero).')
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })
})

describe('CreditPanelWidget hold reason — no horizontal overflow (#8268 review N2)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('wraps an unbroken hold-reason string instead of forcing the row wider', async () => {
    const longReason = 'a'.repeat(200) // no spaces — nothing for the browser to break on by default
    mockAccountsList([{ ...ACCOUNT_ROW, isOnHold: true, holdReason: longReason }])
    await renderPanel()

    const holdReasonText = await screen.findByText((content) => content.includes(longReason))
    const wrapper = holdReasonText.closest('div')
    expect(wrapper).not.toBeNull()
    // `break-words` (`overflow-wrap: break-word`) is what lets the browser break mid-word
    // instead of the row growing past its 390px customer-page container.
    expect(wrapper?.className).toContain('break-words')
  })
})
