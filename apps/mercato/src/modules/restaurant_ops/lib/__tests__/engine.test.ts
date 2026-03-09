import { cartTotals, inventorySnapshot, lineUnitPrice, selectedOptionLabels } from '../engine'
import { restaurantSeed } from '../demo-data'
import type { CartLine } from '../types'

describe('restaurant_ops engine', () => {
  it('calculates line price including selected modifiers', () => {
    const line: CartLine = {
      id: 'c1',
      menuItemId: 'burger-smash',
      quantity: 1,
      note: '',
      selectedOptionIds: ['medium', 'bacon', 'egg'],
    }

    expect(lineUnitPrice(line)).toBe(16.7)
    expect(selectedOptionLabels(line)).toEqual(['Al punto', 'Bacon ahumado', 'Huevo plancha'])
  })

  it('computes cart totals with checkout fee', () => {
    const lines: CartLine[] = [
      {
        id: 'c1',
        menuItemId: 'burger-smash',
        quantity: 2,
        note: '',
        selectedOptionIds: ['medium', 'bacon'],
      },
      {
        id: 'c2',
        menuItemId: 'spritz',
        quantity: 1,
        note: '',
        selectedOptionIds: [],
      },
    ]

    const totals = cartTotals(lines)
    expect(totals.subtotal).toBeCloseTo(39, 5)
    expect(totals.serviceFee).toBeCloseTo(0.78, 5)
    expect(totals.total).toBeCloseTo(39.78, 5)
  })

  it('reflects sold usage, committed cart demand, received receipts, waste and manual adjustments in inventory', () => {
    const orders = [restaurantSeed.orders[0]]
    const activeCart: CartLine[] = [
      {
        id: 'pending-1',
        menuItemId: 'burger-smash',
        quantity: 1,
        note: '',
        selectedOptionIds: ['medium'],
      },
    ]

    const snapshot = inventorySnapshot(
      orders,
      activeCart,
      ['po-340'],
      [
        { ingredientId: 'orange', quantity: 3, type: 'waste', reason: 'Bar spill' },
        { ingredientId: 'pesto', quantity: 120, type: 'adjustment', reason: 'Cycle count correction' },
      ],
    )

    const beef = snapshot.find((item) => item.ingredientId === 'beef')
    const bun = snapshot.find((item) => item.ingredientId === 'bun')
    const orange = snapshot.find((item) => item.ingredientId === 'orange')
    const pesto = snapshot.find((item) => item.ingredientId === 'pesto')

    expect(beef).toEqual(expect.objectContaining({ current: 5820, committed: 180, available: 5640, reorderGap: 0 }))
    expect(bun).toEqual(expect.objectContaining({ current: 51, committed: 1, available: 50, reorderGap: 0 }))
    expect(orange).toEqual(expect.objectContaining({ current: 18, committed: 0, available: 18 }))
    expect(pesto).toEqual(expect.objectContaining({ current: 700, committed: 0, available: 700 }))
  })
})
