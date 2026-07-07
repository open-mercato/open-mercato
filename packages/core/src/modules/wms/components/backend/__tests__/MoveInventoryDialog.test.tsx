/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MoveInventoryDialog } from '../MoveInventoryDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string, params?: Record<string, unknown>) => {
    if (!params) return fallback
    return Object.entries(params).reduce(
      (text, [key, value]) => text.replace(`{${key}}`, String(value)),
      fallback,
    )
  },
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

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: ({
    placeholder,
    value,
    onChange,
  }: {
    placeholder: string
    value: string
    onChange: (v: string) => void
  }) => (
    <input
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={`combobox-${placeholder}`}
    />
  ),
}))

jest.mock('../../../lib/inventoryMutationUi', () => ({
  buildInventoryMutationReferenceId: jest.fn(() => 'ref-001'),
  parseInventoryQuantity: (value: number) => value,
}))

const mockFetchBalanceAvailable = jest.fn()
const mockFetchLocationCapacitySnapshot = jest.fn()

jest.mock('../inventoryMutationLoaders', () => ({
  BalanceLookupError: class BalanceLookupError extends Error {},
  fetchBalanceAvailable: (...args: unknown[]) => mockFetchBalanceAvailable(...args),
  fetchLocationCapacitySnapshot: (...args: unknown[]) => mockFetchLocationCapacitySnapshot(...args),
  loadCatalogVariantOptions: jest.fn(async () => []),
  loadLocationOptions: jest.fn(async () => []),
  loadWarehouseOptions: jest.fn(async () => []),
  resolveCatalogVariantLabel: jest.fn(async () => null),
  resolveLocationLabel: jest.fn(async () => null),
  resolveWarehouseLabel: jest.fn(async () => null),
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

describe('MoveInventoryDialog destination capacity preview', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetchBalanceAvailable.mockResolvedValue(10)
    mockFetchLocationCapacitySnapshot.mockResolvedValue({ capacityUnits: 100, totalOnHand: 80 })
  })

  it('does not show the destination preview until a destination location is selected', () => {
    render(
      <MoveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        initialCatalogVariantId="var-1"
        initialWarehouseId="wh-1"
        initialFromLocationId="loc-from"
      />,
    )
    expect(screen.queryByText('Destination current stock')).toBeNull()
  })

  it('shows destination capacity usage once a destination location is selected', async () => {
    render(
      <MoveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        initialCatalogVariantId="var-1"
        initialWarehouseId="wh-1"
        initialFromLocationId="loc-from"
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Select destination location'), {
      target: { value: 'loc-to' },
    })

    await waitFor(() => {
      expect(mockFetchLocationCapacitySnapshot).toHaveBeenCalledWith({
        warehouseId: 'wh-1',
        locationId: 'loc-to',
      })
    })

    expect(await screen.findByText('Destination current stock')).toBeTruthy()
    expect(await screen.findByText('80 / 100 units used · 20 remaining')).toBeTruthy()
  })

  it('warns when the destination capacity would be exceeded by the move quantity', async () => {
    mockFetchLocationCapacitySnapshot.mockResolvedValue({ capacityUnits: 100, totalOnHand: 95 })

    render(
      <MoveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        initialCatalogVariantId="var-1"
        initialWarehouseId="wh-1"
        initialFromLocationId="loc-from"
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Select destination location'), {
      target: { value: 'loc-to' },
    })
    await screen.findByText('Destination current stock')

    const quantityInput = screen.getByDisplayValue('1')
    fireEvent.change(quantityInput, { target: { value: '8' } })

    expect(
      await screen.findByText('This move would exceed the destination capacity by 3 unit(s).'),
    ).toBeTruthy()
  })

  it('does not warn when the destination has no capacity limit configured', async () => {
    mockFetchLocationCapacitySnapshot.mockResolvedValue({ capacityUnits: null, totalOnHand: 0 })

    render(
      <MoveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        initialCatalogVariantId="var-1"
        initialWarehouseId="wh-1"
        initialFromLocationId="loc-from"
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Select destination location'), {
      target: { value: 'loc-to' },
    })

    expect(await screen.findByText('No capacity limit set for this location.')).toBeTruthy()
    expect(screen.queryByText(/would exceed the destination capacity/)).toBeNull()
  })
})
