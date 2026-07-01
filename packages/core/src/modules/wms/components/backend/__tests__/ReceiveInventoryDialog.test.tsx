/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReceiveInventoryDialog } from '../ReceiveInventoryDialog'

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

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: ({ placeholder }: { placeholder: string }) => (
    <input placeholder={placeholder} data-testid="combobox" readOnly />
  ),
}))

jest.mock('../../../lib/inventoryMutationUi', () => ({
  buildInventoryMutationReferenceId: jest.fn(() => 'ref-001'),
}))

jest.mock('../inventoryMutationLoaders', () => ({
  loadCatalogVariantOptions: jest.fn(async () => []),
  loadInventoryProfileForVariant: jest.fn(async () => null),
  loadLocationOptions: jest.fn(async () => []),
  loadLotNumberOptions: jest.fn(async () => []),
  loadWarehouseOptions: jest.fn(async () => []),
  resolveCatalogVariantLabel: jest.fn(async () => null),
  resolveLocationLabel: jest.fn(async () => null),
  resolveLotNumberFromId: jest.fn(async () => null),
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

describe('ReceiveInventoryDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders without crashing when open', () => {
    const { container } = render(
      <ReceiveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
      />,
    )
    expect(container).toBeTruthy()
  })

  it('shows the dialog title', () => {
    render(
      <ReceiveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
      />,
    )
    expect(screen.getByText('Receive inventory')).toBeTruthy()
  })

  it('does not render when closed', () => {
    render(
      <ReceiveInventoryDialog
        open={false}
        onOpenChange={jest.fn()}
        access={buildAccess()}
      />,
    )
    expect(screen.queryByText('Receive inventory')).toBeNull()
  })

  it('shows the quantity label and defaults to 1', () => {
    render(
      <ReceiveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
      />,
    )
    expect(screen.getByText('Quantity received')).toBeTruthy()
    const textboxes = screen.getAllByRole('textbox')
    const quantityTextbox = textboxes.find(
      (el) => (el as HTMLInputElement).value === '1',
    )
    expect(quantityTextbox).toBeTruthy()
  })

  it('shows the submit button', () => {
    render(
      <ReceiveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Receive' })).toBeTruthy()
  })

  it('accepts initialCatalogVariantId prop without crashing', () => {
    const { container } = render(
      <ReceiveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        initialCatalogVariantId="variant-uuid-1"
        initialWarehouseId="wh-uuid-1"
      />,
    )
    expect(container).toBeTruthy()
  })
})
