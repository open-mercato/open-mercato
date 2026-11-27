/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  InventoryBalancesSection,
  InventoryMovementsSection,
} from '../WmsInventoryConsolePage'

const apiCallMock = jest.fn()

type MockColumn = {
  id?: string
  accessorKey?: string
  header?: React.ReactNode
  cell?: (context: { row: { original: Record<string, unknown> } }) => React.ReactNode
}

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: {
    title: string
    columns: MockColumn[]
    data: Array<Record<string, unknown> & { id: string }>
  }) => (
    <table aria-label={props.title}>
      <thead>
        <tr>
          {props.columns.map((column) => (
            <th key={column.id ?? column.accessorKey}>{column.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.data.map((row) => (
          <tr key={row.id} data-testid={`row-${row.id}`}>
            {props.columns.map((column) => (
              <td key={column.id ?? column.accessorKey} data-column={column.id ?? column.accessorKey}>
                {column.cell ? column.cell({ row: { original: row } }) : null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  ),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('../ReceiveInventoryDialog', () => ({ ReceiveInventoryDialog: () => null }))
jest.mock('../ImportInventoryDialog', () => ({ ImportInventoryDialog: () => null }))
jest.mock('../MoveInventoryDialog', () => ({ MoveInventoryDialog: () => null }))

const access: Parameters<typeof InventoryBalancesSection>[0]['access'] = {
  loading: false,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  scopeReady: true,
  canAdjust: false,
  canManage: false,
  canReceive: false,
  canManageAsn: false,
  canManagePutaway: false,
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

function page<T>(items: T[]) {
  return { ok: true, result: { items, total: items.length, totalPages: 1 } }
}

function serialCell(rowId: string, columnId: string): HTMLElement {
  const cell = screen.getByTestId(`row-${rowId}`).querySelector<HTMLElement>(`[data-column="${columnId}"]`)
  if (!cell) throw new Error('serial number cell not rendered')
  return cell
}

describe('WMS inventory console serial number column', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
  })

  it('shows the serial number of each balance bucket in the balances table', async () => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/wms/inventory/balances')) {
        return page([
          { id: 'bal-serial', catalog_variant_id: 'var-1', location_code: 'B1', serial_number: 'SN-0001', quantity_available: 1 },
          { id: 'bal-plain', catalog_variant_id: 'var-1', location_code: 'B2', serial_number: null, quantity_available: 5 },
        ])
      }
      return page([])
    })

    renderWithProviders(<InventoryBalancesSection access={access} />)

    await waitFor(() => expect(screen.getByTestId('row-bal-serial')).toBeTruthy())
    const table = screen.getByRole('table', { name: 'Inventory balances' })
    expect(within(table).getByRole('columnheader', { name: 'Serial number' })).toBeTruthy()
    expect(serialCell('bal-serial', 'serialNumber').textContent).toBe('SN-0001')
    expect(serialCell('bal-plain', 'serialNumber').textContent).toBe('—')
  })

  it('shows the serial number a movement refers to in the movement ledger', async () => {
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/wms/inventory/movements')) {
        return page([
          { id: 'mov-serial', type: 'putaway', location_from_code: 'DOCK-01', location_to_code: 'B1', serial_number: '  SN-0001  ', quantity: 1 },
          { id: 'mov-plain', type: 'receipt', location_to_code: 'DOCK-01', serial_number: '', quantity: 5 },
        ])
      }
      return page([])
    })

    renderWithProviders(<InventoryMovementsSection />)

    await waitFor(() => expect(screen.getByTestId('row-mov-serial')).toBeTruthy())
    const table = screen.getByRole('table', { name: 'Inventory movement ledger' })
    expect(within(table).getByRole('columnheader', { name: 'Serial number' })).toBeTruthy()
    expect(serialCell('mov-serial', 'serial_number').textContent).toBe('SN-0001')
    expect(serialCell('mov-plain', 'serial_number').textContent).toBe('—')
  })
})
