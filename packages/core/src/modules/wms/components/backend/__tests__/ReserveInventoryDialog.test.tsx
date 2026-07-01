/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReserveInventoryDialog } from '../ReserveInventoryDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback ?? _key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const mockRunMutation = jest.fn()
const mockRetryLastMutation = jest.fn()

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: mockRetryLastMutation,
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
  readJsonSafe: jest.fn(async () => null),
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
  buildInventoryMutationReferenceId: jest.fn(() => 'ref-uuid-001'),
}))

jest.mock('../inventoryMutationLoaders', () => ({
  loadCatalogVariantOptions: jest.fn(async () => []),
  loadLotNumberOptions: jest.fn(async () => []),
  loadWarehouseOptions: jest.fn(async () => []),
  resolveCatalogVariantLabel: jest.fn(async () => null),
  resolveLotNumberFromId: jest.fn(async () => null),
  resolveWarehouseLabel: jest.fn(async () => null),
}))

const buildAccess = (overrides: Record<string, unknown> = {}) => ({
  loading: false,
  organizationId: 'org-uuid-1',
  tenantId: 'tenant-uuid-1',
  userId: 'user-uuid-1',
  scopeReady: true,
  canAdjust: true,
  canReceive: true,
  canReserve: true,
  canCycleCount: true,
  canImport: true,
  canMove: true,
  canRelease: true,
  ...overrides,
})

describe('ReserveInventoryDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders without crashing when open', () => {
    const { container } = render(
      <ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />,
    )
    expect(container).toBeTruthy()
  })

  it('shows the dialog title', () => {
    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)
    expect(screen.getByText('Reserve inventory')).toBeTruthy()
  })

  it('does not render content when closed', () => {
    render(
      <ReserveInventoryDialog open={false} onOpenChange={jest.fn()} access={buildAccess()} />,
    )
    expect(screen.queryByText('Reserve inventory')).toBeNull()
  })

  it('shows Warehouse and Variant comboboxes and Quantity input', () => {
    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)
    expect(screen.getByPlaceholderText('Select warehouse…')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search SKU or name…')).toBeTruthy()
    expect(screen.getByText('Quantity')).toBeTruthy()
  })

  it('quantity input defaults to 1', () => {
    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)
    const input = screen.getByDisplayValue('1') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.type).toBe('number')
  })

  it('shows the Reserve submit button', () => {
    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)
    expect(screen.getByRole('button', { name: /Reserve/ })).toBeTruthy()
  })

  it('shows Cancel button', () => {
    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('shows warehouse required error when submitted without warehouse', async () => {
    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)

    fireEvent.click(screen.getByRole('button', { name: /Reserve/ }))

    expect(await screen.findByText('Select a warehouse.')).toBeTruthy()
    expect(mockRunMutation).not.toHaveBeenCalled()
  })

  it('shows variant required error when submitted without variant but with warehouse', async () => {
    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)

    fireEvent.change(screen.getByPlaceholderText('Select warehouse…'), {
      target: { value: 'wh-uuid-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Reserve/ }))

    expect(await screen.findByText('Select a variant.')).toBeTruthy()
    expect(mockRunMutation).not.toHaveBeenCalled()
  })

  it('shows quantity error when quantity is zero', async () => {
    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)

    fireEvent.change(screen.getByPlaceholderText('Select warehouse…'), {
      target: { value: 'wh-uuid-1' },
    })
    fireEvent.change(screen.getByPlaceholderText('Search SKU or name…'), {
      target: { value: 'var-uuid-1' },
    })
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /Reserve/ }))

    expect(await screen.findByText('Enter a positive quantity.')).toBeTruthy()
    expect(mockRunMutation).not.toHaveBeenCalled()
  })

  it('calls runMutation with correct payload when form is valid', async () => {
    mockRunMutation.mockResolvedValue(undefined)

    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)

    fireEvent.change(screen.getByPlaceholderText('Select warehouse…'), {
      target: { value: 'wh-uuid-1' },
    })
    fireEvent.change(screen.getByPlaceholderText('Search SKU or name…'), {
      target: { value: 'var-uuid-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Reserve/ }))

    await screen.findByRole('button', { name: /Reserve/ })

    expect(mockRunMutation).toHaveBeenCalledTimes(1)
    const callArg = mockRunMutation.mock.calls[0][0] as {
      mutationPayload: Record<string, unknown>
    }
    expect(callArg.mutationPayload).toMatchObject({
      organizationId: 'org-uuid-1',
      tenantId: 'tenant-uuid-1',
      warehouseId: 'wh-uuid-1',
      catalogVariantId: 'var-uuid-1',
      quantity: 1,
      sourceType: 'manual',
      sourceId: 'ref-uuid-001',
    })
  })

  it('does not include lotId in payload when lot is not selected', async () => {
    mockRunMutation.mockResolvedValue(undefined)

    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)

    fireEvent.change(screen.getByPlaceholderText('Select warehouse…'), {
      target: { value: 'wh-uuid-1' },
    })
    fireEvent.change(screen.getByPlaceholderText('Search SKU or name…'), {
      target: { value: 'var-uuid-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Reserve/ }))

    await screen.findByRole('button', { name: /Reserve/ })

    const callArg = mockRunMutation.mock.calls[0][0] as {
      mutationPayload: Record<string, unknown>
    }
    expect(callArg.mutationPayload).not.toHaveProperty('lotId')
  })

  it('shows lot field after variant is selected', () => {
    render(
      <ReserveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        initialCatalogVariantId="var-uuid-1"
      />,
    )
    expect(screen.getByPlaceholderText('Any lot (system selects)…')).toBeTruthy()
  })

  it('hides lot field when no variant is selected', () => {
    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)
    expect(screen.queryByPlaceholderText('Any lot (system selects)…')).toBeNull()
  })

  it('accepts initialWarehouseId and initialCatalogVariantId props', () => {
    render(
      <ReserveInventoryDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        initialWarehouseId="wh-uuid-preset"
        initialCatalogVariantId="var-uuid-preset"
      />,
    )
    expect(screen.getByDisplayValue('wh-uuid-preset')).toBeTruthy()
    expect(screen.getByDisplayValue('var-uuid-preset')).toBeTruthy()
  })

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    const onOpenChange = jest.fn()
    render(
      <ReserveInventoryDialog open onOpenChange={onOpenChange} access={buildAccess()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows Reservation type select with manual option selected by default', () => {
    render(<ReserveInventoryDialog open onOpenChange={jest.fn()} access={buildAccess()} />)
    expect(screen.getByText('Reservation type')).toBeTruthy()
    expect(screen.getAllByText('Manual hold').length).toBeGreaterThan(0)
  })
})
