/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SalesDocumentAddressesSection } from '../AddressesSection'

const mockApiCall = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: any[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: any[]) => mockApiCallOrThrow(...args),
  withScopedApiRequestHeaders: async (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ErrorMessage: () => null,
  LoadingMessage: () => null,
  TabEmptyState: () => null,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      <option value="">Select address</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
}))

jest.mock('@open-mercato/ui/primitives/switch-field', () => ({
  SwitchField: ({ label, checked, onCheckedChange, disabled }: any) => (
    <label>
      {label}
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(event) => onCheckedChange?.(event.target.checked)}
      />
    </label>
  ),
}))

jest.mock('@open-mercato/core/modules/customers/components/AddressEditor', () => ({
  AddressEditor: ({ value, onChange, disabled }: any) => (
    <>
      <span data-testid="address-editor-disabled">{String(Boolean(disabled))}</span>
      {/* The editor renders the contact details itself; what this section owes it is a draft that
          carries them off the snapshot, which is what these expose. */}
      <span data-testid="draft-taxId">{value?.taxId ?? ''}</span>
      <span data-testid="draft-phone">{value?.phone ?? ''}</span>
      <button
        type="button"
        onClick={() =>
          onChange(
            Object.fromEntries(
              Object.keys(value ?? {}).map((key) => [key, typeof value[key] === 'boolean' ? false : '']),
            ),
          )
        }
      >
        Clear address fields
      </button>
      <button type="button" onClick={() => onChange({ ...value, city: '' })}>
        Clear city
      </button>
    </>
  ),
}))

// `addressFormat` is deliberately NOT mocked: stubbing AddressView to () => null is what once let
// a contact block wired to an address path that cannot carry contact details look like a working
// feature. The real formatter is pure and cheap.

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: {}, isReady: true }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('lucide-react', () => ({
  Pencil: () => null,
  Plus: () => null,
  Save: () => null,
  Trash2: () => null,
}))

describe('SalesDocumentAddressesSection', () => {
  beforeEach(() => {
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockApiCall.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/addresses?')) {
        return {
          ok: true,
          result: {
            items: [{
              id: 'customer-address-1',
              name: 'Main warehouse',
              address_line1: '12 Market Street',
              city: 'London',
              postal_code: 'SW1A 1AA',
              country: 'GB',
            }],
          },
        }
      }
      if (url === '/api/customers/settings/address-format') {
        return { ok: true, result: { addressFormat: 'line_first' } }
      }
      return { ok: true, result: { items: [] } }
    })
  })

  it('omits null snapshots for a saved address and adopts the server-resolved snapshot', async () => {
    const resolvedSnapshot = {
      id: 'customer-address-1',
      addressLine1: '12 Market Street',
      city: 'London',
      postalCode: 'SW1A 1AA',
      country: 'GB',
    }
    mockApiCallOrThrow.mockResolvedValue({
      ok: true,
      result: {
        shippingAddressId: 'customer-address-1',
        billingAddressId: 'customer-address-1',
        shippingAddressSnapshot: resolvedSnapshot,
        billingAddressSnapshot: resolvedSnapshot,
      },
    })
    const onUpdated = jest.fn()

    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        onUpdated={onUpdated}
      />,
    )

    await screen.findByRole('combobox')
    await waitFor(() => expect(screen.getByRole('option', { name: /Main warehouse/ })).toBeTruthy())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'customer-address-1' } })
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('customer-address-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Update addresses' }))

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledTimes(1))
    const [, request] = mockApiCallOrThrow.mock.calls[0]
    const payload = JSON.parse(request.body)
    expect(payload).toMatchObject({
      id: 'order-1',
      shippingAddressId: 'customer-address-1',
      billingAddressId: 'customer-address-1',
    })
    expect(payload).not.toHaveProperty('shippingAddressSnapshot')
    expect(payload).not.toHaveProperty('billingAddressSnapshot')
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({
      shippingAddressId: 'customer-address-1',
      shippingAddressSnapshot: resolvedSnapshot,
    }))
  })

  it('keeps a saved address linked after reload and a second save (no silent detach)', async () => {
    const savedSnapshot = {
      id: 'customer-address-1',
      addressLine1: '12 Market Street',
      city: 'London',
      postalCode: 'SW1A 1AA',
      country: 'GB',
    }
    mockApiCallOrThrow.mockResolvedValue({
      ok: true,
      result: {
        shippingAddressId: 'customer-address-1',
        billingAddressId: 'customer-address-1',
        shippingAddressSnapshot: savedSnapshot,
        billingAddressSnapshot: savedSnapshot,
      },
    })
    const onUpdated = jest.fn()

    // Reopening the tab passes both the linked address id and the server-denormalized
    // snapshot — the state after the first correct save. Custom mode must stay off.
    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        shippingAddressId="customer-address-1"
        billingAddressId="customer-address-1"
        shippingAddressSnapshot={savedSnapshot}
        billingAddressSnapshot={savedSnapshot}
        onUpdated={onUpdated}
      />,
    )

    const combobox = await screen.findByRole('combobox')
    await waitFor(() => expect(combobox).toHaveValue('customer-address-1'))
    expect(screen.getByLabelText('Define new address')).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Update addresses' }))

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledTimes(1))
    const [, request] = mockApiCallOrThrow.mock.calls[0]
    const payload = JSON.parse(request.body)
    expect(payload).toMatchObject({
      id: 'order-1',
      shippingAddressId: 'customer-address-1',
      billingAddressId: 'customer-address-1',
    })
    expect(payload.shippingAddressId).not.toBeNull()
    expect(payload.billingAddressId).not.toBeNull()
    expect(payload).not.toHaveProperty('shippingAddressSnapshot')
    expect(payload).not.toHaveProperty('billingAddressSnapshot')
  })

  it('keeps snapshot keys the editor has no field for when the address is saved', async () => {
    mockApiCallOrThrow.mockResolvedValue({ ok: true, result: {} })

    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        shippingAddressSnapshot={{
          addressLine1: '12 Market Street',
          city: 'London',
          postalCode: 'SW1A 1AA',
          country: 'GB',
          taxId: 'PL1234567890',
          phone: '+48 600 100 200',
        }}
      />,
    )

    await screen.findByRole('button', { name: 'Update addresses' })
    fireEvent.click(screen.getByRole('button', { name: 'Update addresses' }))

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledTimes(1))
    const [, request] = mockApiCallOrThrow.mock.calls[0]
    const payload = JSON.parse(request.body)
    expect(payload.shippingAddressSnapshot).toMatchObject({
      addressLine1: '12 Market Street',
      taxId: 'PL1234567890',
      phone: '+48 600 100 200',
    })
  })

  it('clears the whole snapshot when every editable field is emptied, keeping no unowned keys', async () => {
    mockApiCallOrThrow.mockResolvedValue({ ok: true, result: {} })

    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        shippingAddressSnapshot={{
          addressLine1: '12 Market Street',
          city: 'London',
          postalCode: 'SW1A 1AA',
          country: 'GB',
          taxId: 'PL1234567890',
          phone: '+48 600 100 200',
        }}
      />,
    )

    await screen.findByRole('button', { name: 'Update addresses' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear address fields' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Update addresses' }))

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledTimes(1))
    const [, request] = mockApiCallOrThrow.mock.calls[0]
    const payload = JSON.parse(request.body)
    expect(payload.shippingAddressSnapshot).toBeNull()
  })

  it('lets a cleared editable field stay cleared while unowned keys survive', async () => {
    mockApiCallOrThrow.mockResolvedValue({ ok: true, result: {} })

    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        shippingAddressSnapshot={{
          addressLine1: '12 Market Street',
          city: 'London',
          taxId: 'PL1234567890',
        }}
      />,
    )

    await screen.findByRole('button', { name: 'Update addresses' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear city' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Update addresses' }))

    await waitFor(() => expect(mockApiCallOrThrow).toHaveBeenCalledTimes(1))
    const [, request] = mockApiCallOrThrow.mock.calls[0]
    const payload = JSON.parse(request.body)
    expect(payload.shippingAddressSnapshot).not.toHaveProperty('city')
    expect(payload.shippingAddressSnapshot).toMatchObject({
      addressLine1: '12 Market Street',
      taxId: 'PL1234567890',
    })
  })

  it('hands the editor the tax id and phone the snapshot carries', async () => {
    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        billingAddressSnapshot={{
          addressLine1: '12 Market Street',
          city: 'London',
          postalCode: 'SW1A 1AA',
          country: 'GB',
          taxId: 'PL1234567890',
          taxIdType: 'eu_vat',
          phone: '+48 600 100 200',
        }}
      />,
    )

    await screen.findByRole('combobox')
    expect(screen.getByTestId('draft-taxId').textContent).toBe('PL1234567890')
    expect(screen.getByTestId('draft-phone').textContent).toBe('+48 600 100 200')
    // The type interprets the value; it is never a displayed line of its own.
    expect(screen.queryByText(/eu_vat/)).toBeNull()
  })

  it('hands the editor empty fields when the snapshot carries neither', async () => {
    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        billingAddressSnapshot={{
          addressLine1: '12 Market Street',
          city: 'London',
          postalCode: 'SW1A 1AA',
          country: 'GB',
        }}
      />,
    )

    await screen.findByRole('combobox')
    expect(screen.getByTestId('draft-taxId').textContent).toBe('')
    expect(screen.getByTestId('draft-phone').textContent).toBe('')
  })

  it('renders a disabled editor on a locked document, instead of an editable form the API will refuse', async () => {
    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        lockedReason="Document is closed"
        shippingAddressSnapshot={{ addressLine1: '12 Market Street', city: 'London' }}
      />,
    )
    await screen.findByRole('combobox')
    for (const marker of screen.getAllByTestId('address-editor-disabled')) {
      expect(marker.textContent).toBe('true')
    }
  })

  it('keeps the editor editable while the document is not locked', async () => {
    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        shippingAddressSnapshot={{ addressLine1: '12 Market Street', city: 'London' }}
      />,
    )
    await screen.findByRole('combobox')
    for (const marker of screen.getAllByTestId('address-editor-disabled')) {
      expect(marker.textContent).toBe('false')
    }
  })

  it('shows a domestic tax id — the same as any other field on the address', async () => {
    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        billingAddressSnapshot={{
          addressLine1: '12 Market Street',
          city: 'London',
          taxId: '1234567890',
          taxIdType: 'pl_nip',
        }}
      />,
    )
    await screen.findByRole('combobox')
    expect(screen.getByTestId('draft-taxId').textContent).toBe('1234567890')
  })

  it('renders an EU VAT number', async () => {
    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        billingAddressSnapshot={{
          addressLine1: '12 Market Street',
          city: 'London',
          taxId: 'PL1234567890',
          taxIdType: 'eu_vat',
        }}
      />,
    )
    await screen.findByRole('combobox')
    expect(screen.getByTestId('draft-taxId').textContent).toBe('PL1234567890')
  })

  it('shows no snapshot tax id once a saved address is selected, so it cannot show stale details', async () => {
    // The block renders the FROZEN snapshot. With a saved address chosen the tile shows that address
    // while the snapshot still describes the previous one, so the pairing would be a lie until save.
    render(
      <SalesDocumentAddressesSection
        documentId="order-1"
        kind="order"
        customerId="customer-1"
        shippingAddressId="address-1"
        shippingAddressSnapshot={{
          addressLine1: '12 Market Street',
          city: 'London',
          taxId: '1234567890',
          taxIdType: 'pl_nip',
        }}
      />,
    )
    await screen.findAllByRole('combobox')
    expect(screen.queryByText(/1234567890/)).toBeNull()
  })
})
