/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ReleaseReservationDialog } from '../ReleaseReservationDialog'
import type { WmsInventoryMutationAccess } from '../useWmsInventoryMutationAccess'

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

const buildAccess = (): WmsInventoryMutationAccess => ({
  loading: false,
  organizationId: 'org-uuid-1',
  tenantId: 'tenant-uuid-1',
  userId: 'user-uuid-1',
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
})

const reservation = {
  id: 'reservation-uuid-1',
  warehouse_name: 'Main warehouse',
  variant_name: 'Blue shirt',
  variant_sku: 'SHIRT-BLUE',
  quantity: '1',
  source_type: 'manual',
  status: 'active',
}

describe('ReleaseReservationDialog footer layout', () => {
  it('lets the shortcut hint wrap so long translated labels keep the confirm button inside the dialog', () => {
    render(
      <ReleaseReservationDialog
        open
        onOpenChange={jest.fn()}
        access={buildAccess()}
        reservation={reservation}
      />,
    )

    const hint = screen.getByTestId('wms-inventory-release-shortcut-hint')
    expect(hint.className).toContain('sm:min-w-0')
    expect(hint.className).toContain('sm:flex-wrap')

    const actions = screen.getByTestId('wms-inventory-release-actions')
    expect(actions.className).toContain('sm:shrink-0')
    expect(actions).toContainElement(screen.getByTestId('wms-inventory-release-submit'))
  })
})
