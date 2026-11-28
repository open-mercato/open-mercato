/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImportInventoryDialog } from '../ImportInventoryDialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const t = (key: string, fallback?: string, params?: Record<string, unknown>) =>
    (fallback ?? key).replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match))
  return { useT: () => t }
})

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({
  raiseCrudError: jest.fn(),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

const resolved = (rowNumber: number, delta: number) => ({
  rowNumber,
  warehouseId: 'warehouse-1',
  locationId: 'location-1',
  catalogVariantId: 'variant-1',
  quantity: 1,
  delta,
  currentOnHand: 0,
})

const access = {
  loading: false,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  scopeReady: true,
  canImport: true,
} as unknown as React.ComponentProps<typeof ImportInventoryDialog>['access']

describe('ImportInventoryDialog skipped duplicates', () => {
  it('does not send skipped duplicate rows to apply and still reports them as skipped', async () => {
    const apiCallMock = apiCall as jest.Mock
    apiCallMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/validate')) {
        return {
          ok: true,
          result: {
            ok: true,
            importBatchId: 'batch-1',
            summary: { totalRows: 2, validRows: 1, errorRows: 0, warningRows: 0, skipRows: 1 },
            rows: [
              { rowNumber: 1, status: 'valid', errors: [], warnings: [], input: {}, resolved: resolved(1, 1) },
              {
                rowNumber: 2,
                status: 'skip',
                errors: [],
                warnings: ['duplicate_row', 'duplicate_of_row_1'],
                input: {},
                resolved: resolved(2, 0),
              },
            ],
          },
        }
      }
      return { ok: true, result: { ok: true, summary: { applied: 1, skipped: 0, failed: 0 } } }
    })

    render(<ImportInventoryDialog open onOpenChange={jest.fn()} access={access} />)

    const csv = 'warehouse_code,location_code,sku,quantity\nW1,L1,SKU-1,1\nW1,L1,SKU-1,1\n'
    const file = new File([csv], 'duplicates.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: async () => csv })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await screen.findByText(/duplicates\.csv/)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Step 2 of 3 · Map CSV columns to fields')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Import 1 rows' }))

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Import finished (1 applied, 1 skipped).', 'success'))
    const applyCall = apiCallMock.mock.calls.find(([url]) => url.endsWith('/apply'))
    const body = JSON.parse(applyCall![1].body)
    expect(body.rows.map((row: { rowNumber: number }) => row.rowNumber)).toEqual([1])
  })
})
