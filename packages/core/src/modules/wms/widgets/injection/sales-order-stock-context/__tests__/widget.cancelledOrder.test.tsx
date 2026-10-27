/**
 * @jest-environment jsdom
 *
 * Regression test for issue #4521: a cancelled sales order must not offer "Re-run reservation",
 * because a cancelled order cannot hold a live stock reservation.
 */
import * as React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import SalesOrderStockContextWidget, { type SalesOrderRecord } from '../widget.client'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('lucide-react', () => {
  const IconStub = () => null
  return new Proxy(
    { __esModule: true },
    { get: (target, prop) => (prop in target ? (target as Record<string | symbol, unknown>)[prop] : IconStub) },
  )
})
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback?: string) => fallback ?? _key,
}))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeDetail: () => ({ organizationId: 'org-1', tenantId: 'tenant-1' }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/serverErrors', () => ({ raiseCrudError: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({ ComboboxInput: () => null }))
jest.mock('../../../../components/backend/useWmsInventoryMutationAccess', () => ({
  useWmsInventoryMutationAccess: () => ({ canRelease: true, canAdjust: true }),
}))
jest.mock('../../../../components/backend/wmsLookupLoaders', () => ({ loadWarehouseOptions: jest.fn(async () => []) }))
jest.mock('../../../../components/backend/inventoryMutationLoaders', () => ({
  resolveCatalogVariantLabel: jest.fn(async () => null),
  resolveWarehouseLabel: jest.fn(async () => null),
}))
jest.mock('../../../../components/backend/ReleaseReservationDialog', () => ({ ReleaseReservationDialog: () => null }))

function renderWidget(status: string | null) {
  const data: SalesOrderRecord = {
    id: 'order-1',
    status,
    _wms: { reservationSummary: { status: 'unreserved', reservationIds: [] }, stockSummary: [] },
  }
  return render(<SalesOrderStockContextWidget {...({ data } as never)} />)
}

describe('SalesOrderStockContextWidget on a cancelled order (issue #4521)', () => {
  it('hides "Re-run reservation" when the order is cancelled', () => {
    renderWidget('canceled')
    expect(screen.queryByRole('button', { name: /Re-run reservation/ })).not.toBeInTheDocument()
  })

  it('keeps "Re-run reservation" for an active order', () => {
    renderWidget('confirmed')
    expect(screen.getByRole('button', { name: /Re-run reservation/ })).toBeInTheDocument()
  })
})
