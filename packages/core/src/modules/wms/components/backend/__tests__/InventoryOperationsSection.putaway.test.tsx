/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { InventoryOperationsSection } from '../InventoryOperationsSection'

const mockMoveProps = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}))

jest.mock('../ReceiveInventoryDialog', () => ({
  ReceiveInventoryDialog: ({ onSuccess }: { onSuccess: (ctx: Record<string, unknown>) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSuccess({
          catalogVariantId: 'variant-1',
          warehouseId: 'warehouse-1',
          locationId: 'location-1',
          lotId: 'lot-1',
          quantity: 3,
        })
      }
    >
      finish receipt
    </button>
  ),
}))

jest.mock('../MoveInventoryDialog', () => ({
  MoveInventoryDialog: (props: Record<string, unknown>) => {
    mockMoveProps(props)
    return null
  },
}))

jest.mock('../AdjustInventoryDialog', () => ({ AdjustInventoryDialog: () => null }))
jest.mock('../CycleCountWizardDialog', () => ({ CycleCountWizardDialog: () => null }))
jest.mock('../ImportInventoryDialog', () => ({ ImportInventoryDialog: () => null }))
jest.mock('../ReserveInventoryDialog', () => ({ ReserveInventoryDialog: () => null }))

describe('InventoryOperationsSection putaway', () => {
  it('opens the putaway dialog with the received lot and quantity', () => {
    const access = { scopeReady: true, canReceive: true, canMove: true } as unknown as React.ComponentProps<
      typeof InventoryOperationsSection
    >['access']
    render(<InventoryOperationsSection access={access} />)

    fireEvent.click(screen.getByText('finish receipt'))

    expect(mockMoveProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        open: true,
        movementType: 'putaway',
        initialLotId: 'lot-1',
        initialQuantity: 3,
      }),
    )
  })
})
