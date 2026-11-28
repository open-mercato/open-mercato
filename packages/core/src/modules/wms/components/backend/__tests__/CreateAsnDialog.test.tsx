/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateAsnDialog } from '../CreateAsnDialog'
import type { WmsInventoryMutationAccess } from '../useWmsInventoryMutationAccess'

const mockApiCall = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
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

const mockHasStagingLocations = jest.fn()

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

jest.mock('../inventoryMutationLoaders', () => ({
  hasStagingLocations: (...args: unknown[]) => mockHasStagingLocations(...args),
  loadCatalogVariantOptions: jest.fn(async () => []),
  loadStagingLocationOptions: jest.fn(async () => []),
  loadWarehouseOptions: jest.fn(async () => []),
  resolveCatalogVariantLabel: jest.fn(async () => null),
  resolveLocationLabel: jest.fn(async () => null),
  resolveWarehouseLabel: jest.fn(async () => null),
}))

const access: WmsInventoryMutationAccess = {
  loading: false,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  scopeReady: true,
  canAdjust: false,
  canManage: true,
  canReceive: true,
  canManageAsn: true,
  canManagePutaway: true,
  canCycleCount: false,
  canImport: false,
  canMove: false,
  canRelease: false,
  canReserve: false,
  canAllocate: false,
  canManageLocations: false,
  canManageWarehouses: false,
  canManageZones: false,
  canManageLots: false,
}

describe('CreateAsnDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockHasStagingLocations.mockResolvedValue(true)
  })

  it('shows a missing-location hint once a warehouse without Dock or Staging locations is selected', async () => {
    mockHasStagingLocations.mockResolvedValue(false)
    render(<CreateAsnDialog open onOpenChange={jest.fn()} access={access} />)

    expect(screen.queryByTestId('wms-staging-location-missing-hint')).toBeNull()
    expect(mockHasStagingLocations).not.toHaveBeenCalled()

    fireEvent.change(screen.getByTestId('combobox-Select warehouse'), {
      target: { value: '22222222-2222-2222-2222-222222222222' },
    })

    const hint = await screen.findByTestId('wms-staging-location-missing-hint')
    expect(hint.querySelector('a')?.getAttribute('href')).toBe('/backend/wms/locations')
    expect(mockHasStagingLocations).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222')
  })

  it('does not show the missing-location hint when the selected warehouse has a Dock or Staging location', async () => {
    render(<CreateAsnDialog open onOpenChange={jest.fn()} access={access} />)

    fireEvent.change(screen.getByTestId('combobox-Select warehouse'), {
      target: { value: '22222222-2222-2222-2222-222222222222' },
    })

    await waitFor(() => expect(mockHasStagingLocations).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByTestId('wms-staging-location-missing-hint')).toBeNull()
  })

  it('shows translatable validation errors instead of raw zod messages on an empty submit', async () => {
    render(<CreateAsnDialog open onOpenChange={jest.fn()} access={access} />)

    fireEvent.click(screen.getByTestId('create-asn-submit'))

    expect(await screen.findByText('wms.backend.asns.create.errors.warehouseRequired')).toBeTruthy()
    expect(screen.getByText('wms.backend.asns.create.errors.variantRequired')).toBeTruthy()
    expect(screen.queryByText('Invalid UUID')).toBeNull()
    expect(screen.queryByText(/Too small/)).toBeNull()
    expect(mockApiCall).not.toHaveBeenCalled()
  })

  it('shows a translatable error when the expected quantity is not positive', async () => {
    render(<CreateAsnDialog open onOpenChange={jest.fn()} access={access} />)

    const quantityInput = document.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(quantityInput, { target: { value: '0' } })
    fireEvent.submit(quantityInput.closest('form') as HTMLFormElement)

    expect(await screen.findByText('wms.backend.asns.create.errors.quantityPositive')).toBeTruthy()
    expect(screen.queryByText(/Too small/)).toBeNull()
    expect(mockApiCall).not.toHaveBeenCalled()
  })
})
