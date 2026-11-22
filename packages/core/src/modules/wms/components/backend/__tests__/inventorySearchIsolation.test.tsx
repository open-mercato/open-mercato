/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import WmsInventoryConsolePage, { InventoryReservationsSection, InventoryMovementsSection } from '../WmsInventoryConsolePage'
import type { WmsInventoryMutationAccess } from '../useWmsInventoryMutationAccess'

const mockReplace = jest.fn()
const mockApiCall = jest.fn()
const mockFlash = jest.fn()
const mockInvalidateQueries = jest.fn()
const mockTriggerEvent = jest.fn()
const mockDispatchMutationError = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, refresh: jest.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
  useLocale: () => 'en',
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => mockFlash(...args) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => Promise<unknown>) => operation(),
}))
jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionSpotEvents: () => ({ triggerEvent: (...args: unknown[]) => mockTriggerEvent(...args) }),
}))
jest.mock('@open-mercato/ui/backend/injection/mutationEvents', () => ({
  GLOBAL_MUTATION_INJECTION_SPOT_ID: 'global',
  dispatchBackendMutationError: (...args: unknown[]) => mockDispatchMutationError(...args),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn() }))
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args) }),
  useQuery: () => ({ data: { items: [], total: 0, totalPages: 1 } }),
}))
jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ onValueChange }: { onValueChange: (value: string) => void }) => (
    <button type="button" onClick={() => onValueChange('manual_release')}>Select test reason</button>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ searchValue, onSearchChange, searchPlaceholder }: {
    searchValue: string
    onSearchChange: (value: string) => void
    searchPlaceholder: string
  }) => <input aria-label={searchPlaceholder} value={searchValue} onChange={(event) => onSearchChange(event.target.value)} />,
}))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect: () => void }> }) => (
    <div>{items.map((item) => <button type="button" key={item.id} onClick={item.onSelect}>{item.label}</button>)}</div>
  ),
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({ ComboboxInput: () => null }))
jest.mock('../InventoryOperationsSection', () => ({ InventoryOperationsSection: () => null }))
jest.mock('../useWmsInventoryMutationAccess', () => ({ useWmsInventoryMutationAccess: () => access }))
jest.mock('../inventoryMutationLoaders', () => ({
  loadCatalogVariantOptions: jest.fn(async () => []),
  loadWarehouseOptions: jest.fn(async () => []),
  resolveCatalogVariantLabel: jest.fn(async () => ''),
  resolveWarehouseLabel: jest.fn(async () => ''),
}))

const access: WmsInventoryMutationAccess = {
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
}

jest.mock('../ImportInventoryDialog', () => ({ ImportInventoryDialog: () => null }))
jest.mock('../MoveInventoryDialog', () => ({ MoveInventoryDialog: () => null }))
jest.mock('../ReceiveInventoryDialog', () => ({ ReceiveInventoryDialog: () => null }))
jest.mock('../ReleaseReservationDialog', () => ({ ReleaseReservationDialog: () => null }))

describe('inventory console search isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.history.replaceState(null, '', '/backend/wms/inventory?warehouseId=warehouse-1&search=ATLAS')
  })

  it('keeps the three section searches independent of a shared URL search parameter', () => {
    render(<WmsInventoryConsolePage />)
    const balances = screen.getByRole('textbox', { name: 'Search balances' })
    const reservations = screen.getByRole('textbox', { name: 'Search reservations' })
    const movements = screen.getByRole('textbox', { name: 'Search movement ledger' })

    expect(balances).toHaveValue('')
    expect(reservations).toHaveValue('')
    expect(movements).toHaveValue('')
    fireEvent.change(reservations, { target: { value: 'ATLAS' } })
    fireEvent.change(balances, { target: { value: 'BETA' } })
    expect(reservations).toHaveValue('ATLAS')
    expect(balances).toHaveValue('BETA')
    expect(movements).toHaveValue('')
    fireEvent.change(reservations, { target: { value: '' } })
    expect(reservations).toHaveValue('')
    expect(balances).toHaveValue('BETA')
    expect(movements).toHaveValue('')
    expect(mockReplace).not.toHaveBeenCalled()
    expect(window.location.search).toBe('?warehouseId=warehouse-1&search=ATLAS')
  })

  it.each([
    { pathname: '/backend/wms/reservations', searchLabel: 'Search reservations', page: () => <InventoryReservationsSection access={access} /> },
    { pathname: '/backend/wms/movements', searchLabel: 'Search movement ledger', page: () => <InventoryMovementsSection /> },
  ])('preserves the standalone $pathname search permalink', ({ pathname, searchLabel, page }) => {
    window.history.replaceState(null, '', `${pathname}?warehouseId=warehouse-1&search=ATLAS`)
    render(page())
    const search = screen.getByRole('textbox', { name: searchLabel })
    expect(search).toHaveValue('ATLAS')
    fireEvent.change(search, { target: { value: 'BETA' } })
    expect(mockReplace).toHaveBeenCalledWith(`${pathname}?warehouseId=warehouse-1&search=BETA`, { scroll: false })
  })
})
