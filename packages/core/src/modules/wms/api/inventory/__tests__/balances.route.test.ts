import { transformInventoryBalanceListItem } from '../balances/route'

describe('wms inventory balances route helpers', () => {
  it('prefers the database-computed quantity_available when present', () => {
    const result = transformInventoryBalanceListItem({
      quantity_on_hand: '10',
      quantity_reserved: '3',
      quantity_allocated: '2',
      quantity_available: '5',
    })

    expect(result.quantity_available).toBe(5)
  })

  it('falls back to on_hand - reserved - allocated when quantity_available is missing', () => {
    const result = transformInventoryBalanceListItem({
      quantity_on_hand: '10',
      quantity_reserved: '3',
      quantity_allocated: '2',
    })

    expect(result.quantity_available).toBe(5)
  })

  it('falls back to on_hand - reserved - allocated when quantity_available is null', () => {
    const result = transformInventoryBalanceListItem({
      quantity_on_hand: '10',
      quantity_reserved: '3',
      quantity_allocated: '2',
      quantity_available: null,
    })

    expect(result.quantity_available).toBe(5)
  })

  it('treats missing on_hand/reserved/allocated as zero', () => {
    const result = transformInventoryBalanceListItem({})

    expect(result.quantity_available).toBe(0)
  })

  it('preserves the true available ordering even when on-hand ordering would differ', () => {
    const highOnHandHighlyReserved = transformInventoryBalanceListItem({
      quantity_on_hand: '100',
      quantity_reserved: '95',
      quantity_allocated: '0',
      quantity_available: '5',
    })
    const lowOnHandUnreserved = transformInventoryBalanceListItem({
      quantity_on_hand: '20',
      quantity_reserved: '0',
      quantity_allocated: '0',
      quantity_available: '20',
    })

    expect(Number(highOnHandHighlyReserved.quantity_available)).toBeLessThan(
      Number(lowOnHandUnreserved.quantity_available),
    )
    expect(Number(highOnHandHighlyReserved.quantity_on_hand)).toBeGreaterThan(
      Number(lowOnHandUnreserved.quantity_on_hand),
    )
  })
})
