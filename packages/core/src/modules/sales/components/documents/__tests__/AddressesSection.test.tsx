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
  AddressEditor: () => null,
}))

jest.mock('@open-mercato/core/modules/customers/utils/addressFormat', () => ({
  AddressView: () => null,
  formatAddressString: (value: Record<string, unknown>) =>
    [value.addressLine1, value.city].filter(Boolean).join(', '),
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
})
