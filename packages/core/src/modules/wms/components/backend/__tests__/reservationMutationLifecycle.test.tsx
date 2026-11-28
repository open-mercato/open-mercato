/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReleaseReservationDialog } from '../ReleaseReservationDialog'
import { InventoryReservationsSection } from '../WmsInventoryConsolePage'
import type { WmsInventoryMutationAccess } from '../useWmsInventoryMutationAccess'

const mockApiCall = jest.fn()
const mockFlash = jest.fn()
const mockInvalidateQueries = jest.fn()
const mockTriggerEvent = jest.fn()
const mockDispatchMutationError = jest.fn()

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
  useQuery: () => ({ data: { items: [{ id: 'reservation-1', status: 'active' }], total: 1, totalPages: 1 } }),
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
  DataTable: ({ data, rowActions }: { data: Array<Record<string, unknown>>; rowActions: (row: Record<string, unknown>) => React.ReactNode }) => (
    <div>{data.map((row) => <div key={String(row.id)}>{rowActions(row)}</div>)}</div>
  ),
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

const reservation = { id: 'reservation-1', status: 'active', quantity: '1' }

function retryFromMutationContext(): () => Promise<boolean> {
  const beforeSave = mockTriggerEvent.mock.calls.find(([event]) => event === 'onBeforeSave')
  const context = beforeSave?.[2] as { retryLastMutation: () => Promise<boolean> }
  return context.retryLastMutation
}

describe('reservation mutation lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockTriggerEvent.mockResolvedValue({ ok: true })
    mockInvalidateQueries.mockResolvedValue(undefined)
  })

  it('rejects a stale release and its retry without emitting success', async () => {
    mockApiCall.mockResolvedValue({ ok: false, response: { status: 409 }, result: { error: 'invalid_reservation_state' } })
    render(<ReleaseReservationDialog open onOpenChange={jest.fn()} access={access} reservation={reservation} />)
    fireEvent.click(screen.getByText('Select test reason'))
    fireEvent.click(screen.getByTestId('wms-inventory-release-submit'))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(expect.stringContaining('no longer active'), 'error'))
    expect(mockTriggerEvent.mock.calls.some(([event]) => event === 'onAfterSave')).toBe(false)
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['wms-inventory-console'] })
    let retried = true
    await act(async () => { retried = await retryFromMutationContext()() })
    expect(retried).toBe(false)
    expect(mockDispatchMutationError).toHaveBeenCalledTimes(2)
    expect(mockTriggerEvent.mock.calls.some(([event]) => event === 'onAfterSave')).toBe(false)
    expect(mockFlash).not.toHaveBeenCalledWith(expect.anything(), 'success')
  })

  it('rejects a balance integrity conflict and its retry without emitting success', async () => {
    mockApiCall.mockResolvedValue({ ok: false, response: { status: 409 }, result: { error: 'balance_integrity_violation' } })
    render(<ReleaseReservationDialog open onOpenChange={jest.fn()} access={access} reservation={reservation} />)
    fireEvent.click(screen.getByText('Select test reason'))
    fireEvent.click(screen.getByTestId('wms-inventory-release-submit'))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(expect.stringContaining('Balance integrity error'), 'error'))
    expect(mockTriggerEvent.mock.calls.some(([event]) => event === 'onAfterSave')).toBe(false)
    let retried = true
    await act(async () => { retried = await retryFromMutationContext()() })
    expect(retried).toBe(false)
    expect(mockDispatchMutationError).toHaveBeenCalledTimes(2)
    expect(mockTriggerEvent.mock.calls.some(([event]) => event === 'onAfterSave')).toBe(false)
    expect(mockFlash).not.toHaveBeenCalledWith(expect.anything(), 'success')
  })

  it('emits success after a release succeeds', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { ok: true } })
    render(<ReleaseReservationDialog open onOpenChange={jest.fn()} access={access} reservation={reservation} />)
    fireEvent.click(screen.getByText('Select test reason'))
    fireEvent.click(screen.getByTestId('wms-inventory-release-submit'))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Reservation released', 'success'))
    expect(mockTriggerEvent.mock.calls.some(([event]) => event === 'onAfterSave')).toBe(true)
  })

  it('rejects a stale allocation and its retry without emitting success', async () => {
    mockApiCall.mockResolvedValue({ ok: false, response: { status: 409 }, result: { error: 'invalid_reservation_state' } })
    render(<InventoryReservationsSection access={{ ...access, canRelease: false }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allocate' }))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith(expect.stringContaining('no longer active'), 'error'))
    expect(mockTriggerEvent.mock.calls.some(([event]) => event === 'onAfterSave')).toBe(false)
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['wms-inventory-console'] })
    let retried = true
    await act(async () => { retried = await retryFromMutationContext()() })
    expect(retried).toBe(false)
    expect(mockDispatchMutationError).toHaveBeenCalledTimes(2)
    expect(mockTriggerEvent.mock.calls.some(([event]) => event === 'onAfterSave')).toBe(false)
    expect(mockFlash).not.toHaveBeenCalledWith(expect.anything(), 'success')
  })

  it('emits success after an allocation succeeds', async () => {
    mockApiCall.mockResolvedValue({ ok: true, result: { ok: true } })
    render(<InventoryReservationsSection access={{ ...access, canRelease: false }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allocate' }))
    await waitFor(() => expect(mockFlash).toHaveBeenCalledWith('Reservation allocated', 'success'))
    expect(mockTriggerEvent.mock.calls.some(([event]) => event === 'onAfterSave')).toBe(true)
  })
})
