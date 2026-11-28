/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  InventoryProfilesSection,
  LocationSection,
  WarehouseSection,
  ZoneSection,
} from '../WmsConfigurationPage'

type CapturedTable = {
  title?: string
  rowActions?: (row: Record<string, unknown>) => React.ReactNode
}

const apiCallMock = jest.fn()
const capturedTables: CapturedTable[] = []
let accessMock: Record<string, boolean> = {}

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: CapturedTable) => {
    capturedTables.push(props)
    return <div data-testid="data-table" data-has-row-actions={props.rowActions ? 'true' : 'false'} />
  },
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string }> }) => (
    <ul>
      {items.map((item) => (
        <li key={item.id} data-testid={`row-action-${item.id}`}>{item.label}</li>
      ))}
    </ul>
  ),
}))

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: () => null,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('../useWmsInventoryMutationAccess', () => ({
  useWmsInventoryMutationAccess: () => accessMock,
}))

jest.mock('../LocationEditDialog', () => ({ LocationEditDialog: () => null }))
jest.mock('../WarehouseEditDialog', () => ({ WarehouseEditDialog: () => null }))

jest.mock('../wmsLookupLoaders', () => ({
  buildQuery: () => '',
  loadCatalogVariantOptions: jest.fn(async () => []),
  loadWarehouseOptions: jest.fn(async () => []),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async <T,>({ operation }: { operation: () => Promise<T> }) => operation(),
    retryLastMutation: async () => true,
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))

const sections: Array<{ name: string; Component: React.ComponentType; feature: string }> = [
  { name: 'Warehouses', Component: WarehouseSection, feature: 'canManageWarehouses' },
  { name: 'Zones', Component: ZoneSection, feature: 'canManageZones' },
  { name: 'Locations', Component: LocationSection, feature: 'canManageLocations' },
  { name: 'Inventory profiles', Component: InventoryProfilesSection, feature: 'canManage' },
]

const allManageFlags = {
  canManageWarehouses: true,
  canManageZones: true,
  canManageLocations: true,
  canManage: true,
}

function renderSection(Component: React.ComponentType) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(<Component />, { queryClient })
}

function lastCapturedTable(): CapturedTable {
  const table = capturedTables[capturedTables.length - 1]
  if (!table) throw new Error('[internal] DataTable was not rendered')
  return table
}

describe('WMS configuration row actions respect manage permissions', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [], total: 0, totalPages: 1 } })
    capturedTables.length = 0
  })

  it.each(sections)('$name hides edit and delete row actions without $feature', async ({ Component }) => {
    accessMock = { canManageWarehouses: false, canManageZones: false, canManageLocations: false, canManage: false }

    renderSection(Component)

    await screen.findByTestId('data-table')
    expect(screen.getByTestId('data-table')).toHaveAttribute('data-has-row-actions', 'false')
    expect(lastCapturedTable().rowActions).toBeUndefined()
  })

  it.each(sections)('$name keeps row actions hidden when only other manage features are granted', async ({ Component, feature }) => {
    accessMock = { ...allManageFlags, [feature]: false }

    renderSection(Component)

    await screen.findByTestId('data-table')
    expect(lastCapturedTable().rowActions).toBeUndefined()
  })

  it.each(sections)('$name shows edit and delete row actions with $feature', async ({ Component, feature }) => {
    accessMock = { canManageWarehouses: false, canManageZones: false, canManageLocations: false, canManage: false, [feature]: true }

    renderSection(Component)

    await waitFor(() => expect(screen.getByTestId('data-table')).toHaveAttribute('data-has-row-actions', 'true'))
    const rowActions = lastCapturedTable().rowActions
    if (!rowActions) throw new Error('[internal] rowActions missing')
    render(<>{rowActions({ id: 'row-1' })}</>)
    expect(screen.getByTestId('row-action-edit')).toBeInTheDocument()
    expect(screen.getByTestId('row-action-delete')).toBeInTheDocument()
  })
})
