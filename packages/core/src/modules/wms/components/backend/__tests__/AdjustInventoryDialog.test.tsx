/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { AdjustInventoryDialog } from '../AdjustInventoryDialog'
import type { WmsInventoryMutationAccess } from '../useWmsInventoryMutationAccess'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback ?? _key,
  useLocale: () => 'en-US',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const mockRunMutation = jest.fn()

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
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
}))

jest.mock('../inventoryMutationLoaders', () => ({
  BalanceLookupError: class BalanceLookupError extends Error {},
  InventoryLotMutationError: class InventoryLotMutationError extends Error {},
  ensureLotIdForInventoryMutation: jest.fn(async () => null),
  fetchBalanceOnHand: jest.fn(async () => 10),
  fetchVariantReorderPoint: jest.fn(async () => 0),
  findLotIdByNumber: jest.fn(async () => null),
  loadCatalogVariantOptions: jest.fn(async () => []),
  loadLocationOptions: jest.fn(async () => []),
  loadLotNumberOptions: jest.fn(async () => []),
  loadWarehouseOptions: jest.fn(async () => []),
  resolveCatalogVariantLabel: jest.fn(async () => null),
  resolveLocationLabel: jest.fn(async () => null),
  resolveLotNumberFromId: jest.fn(async () => null),
  resolveWarehouseLabel: jest.fn(async () => null),
}))

const buildAccess = (overrides: Partial<WmsInventoryMutationAccess> = {}): WmsInventoryMutationAccess => ({
  loading: false,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  scopeReady: true,
  canAdjust: true,
  canManage: true,
  canReceive: true,
  canCycleCount: true,
  canImport: true,
  canMove: true,
  canRelease: true,
  canReserve: true,
  canAllocate: true,
  canManageLocations: true,
  canManageWarehouses: true,
  canManageZones: true,
  canManageLots: true,
  ...overrides,
})

describe('AdjustInventoryDialog reason validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows a localized error instead of the raw enum message when no reason is selected', async () => {
    render(
      <AdjustInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        initialCatalogVariantId="11111111-1111-4111-8111-111111111111"
        initialWarehouseId="22222222-2222-4222-8222-222222222222"
        initialLocationId="33333333-3333-4333-8333-333333333333"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }))

    expect(await screen.findByText('Reason is required.')).toBeTruthy()
    expect(screen.queryByText(/Invalid option/)).toBeNull()
    expect(mockRunMutation).not.toHaveBeenCalled()
  })

  it('shows localized errors for every empty picker instead of raw zod messages', async () => {
    render(<AdjustInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }))

    expect(await screen.findByText('Variant is required.')).toBeTruthy()
    expect(screen.getByText('Warehouse is required.')).toBeTruthy()
    expect(screen.getByText('Location is required.')).toBeTruthy()
    expect(screen.getByText('Reason is required.')).toBeTruthy()
    expect(screen.queryByText(/Invalid UUID/)).toBeNull()
    expect(screen.queryByText(/Invalid option/)).toBeNull()
    expect(mockRunMutation).not.toHaveBeenCalled()
  })
})
