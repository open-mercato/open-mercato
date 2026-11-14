/**
 * @jest-environment jsdom
 */
/**
 * Regression test for issue #6834.
 *
 * A negative adjustment larger than the bucket's available quantity is rejected by the
 * `wms.inventory.adjust` command with `409 { error: 'insufficient_stock' }`. The dialog
 * forwarded that body to `raiseCrudError`, so the toast showed the bare code
 * `insufficient_stock` instead of a translated explanation (the Reserve dialog already
 * mapped the same code).
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AdjustInventoryDialog } from '../AdjustInventoryDialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback ?? _key,
  useLocale: () => 'en',
}))

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

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: ({ placeholder, value }: { placeholder: string; value: string }) => (
    <input placeholder={placeholder} value={value} readOnly />
  ),
}))

jest.mock('@open-mercato/ui/primitives/select', () => ({
  Select: ({ value, onValueChange }: { value?: string; onValueChange: (next: string) => void }) => (
    <select aria-label="reason" value={value ?? ''} onChange={(event) => onValueChange(event.target.value)}>
      <option value="" />
      <option value="shrinkage">shrinkage</option>
    </select>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}))

jest.mock('../../../lib/inventoryMutationUi', () => ({
  buildInventoryMutationReferenceId: jest.fn(() => 'ref-uuid-001'),
}))

jest.mock('../inventoryMutationLoaders', () => ({
  BalanceLookupError: class BalanceLookupError extends Error {},
  InventoryLotMutationError: class InventoryLotMutationError extends Error {},
  ensureLotIdForInventoryMutation: jest.fn(async () => undefined),
  fetchBalanceOnHand: jest.fn(async () => 92),
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

const VARIANT_ID = '11111111-1111-4111-8111-111111111111'
const WAREHOUSE_ID = '22222222-2222-4222-8222-222222222222'
const LOCATION_ID = '33333333-3333-4333-8333-333333333333'

const access = {
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
} as unknown as React.ComponentProps<typeof AdjustInventoryDialog>['access']

function buildErrorResponse(status: number, body: unknown): Response {
  const build = (): Response =>
    ({
      ok: false,
      status,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(body),
      json: async () => body,
      clone: () => build(),
    }) as unknown as Response
  return build()
}

function renderAndSubmit() {
  render(
    <AdjustInventoryDialog
      open
      onOpenChange={jest.fn()}
      access={access}
      initialCatalogVariantId={VARIANT_ID}
      initialWarehouseId={WAREHOUSE_ID}
      initialLocationId={LOCATION_ID}
    />,
  )
  fireEvent.change(screen.getByLabelText('reason'), { target: { value: 'shrinkage' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }))
}

describe('AdjustInventoryDialog insufficient stock error (issue #6834)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows a translated message instead of the raw insufficient_stock code', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: false,
      result: null,
      response: buildErrorResponse(409, { error: 'insufficient_stock' }),
    })

    renderAndSubmit()

    await waitFor(() => expect(flash).toHaveBeenCalled())
    expect(apiCall).toHaveBeenCalledWith('/api/wms/inventory/adjust', expect.anything())
    expect(flash).toHaveBeenCalledWith(
      'The adjustment is larger than the available quantity in this location.',
      'error',
    )
    expect(flash).not.toHaveBeenCalledWith('insufficient_stock', 'error')
    expect(screen.getByText('Adjust inventory')).toBeTruthy()
  })

  it('keeps surfacing other server errors through raiseCrudError', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: false,
      result: null,
      response: buildErrorResponse(400, { error: 'Lot is not active.' }),
    })

    renderAndSubmit()

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Lot is not active.', 'error'))
  })
})
