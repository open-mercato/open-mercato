import { describe, test, expect } from '@jest/globals'
import { computeCheckoutTotals, convertCheckoutPrice } from '../checkoutTotals'

describe('computeCheckoutTotals', () => {
  test('rounds the 8% tax to cents instead of sending the raw float', () => {
    const totals = computeCheckoutTotals([{ id: 'p1', name: 'Widget', price: 49.99, quantity: 1 }], 1, 'USD')

    expect(totals.subtotal).toBe(49.99)
    expect(totals.tax).toBe(4)
    expect(totals.shipping).toBe(9.99)
    expect(totals.total).toBe(63.98)
  })

  test('rounds converted prices and keeps the total equal to the sum of its rounded parts', () => {
    const totals = computeCheckoutTotals(
      [
        { id: 'p1', name: 'Widget', price: 99.99, quantity: 1 },
        { id: 'p2', name: 'Gadget', price: 29.99, quantity: 2 },
      ],
      0.92,
      'EUR',
    )

    expect(totals.items.map((item) => item.price)).toEqual([91.99, 27.59])
    expect(totals.subtotal).toBe(147.17)
    expect(totals.tax).toBe(11.77)
    expect(totals.shipping).toBe(9.19)
    expect(totals.total).toBe(168.13)
  })

  test('rounds a half-cent conversion up the same way in the picker and the cart', () => {
    const totals = computeCheckoutTotals([{ id: 'p1', name: 'Widget', price: 1.25, quantity: 1 }], 4.02, 'PLN')

    expect(convertCheckoutPrice(1.25, 4.02, 'PLN')).toBe(5.03)
    expect(totals.items[0].price).toBe(5.03)
    expect(totals.subtotal).toBe(5.03)
  })

  test('uses zero decimal places for a currency without minor units', () => {
    const totals = computeCheckoutTotals([{ id: 'p1', name: 'Widget', price: 49.99, quantity: 1 }], 150.5, 'JPY')

    expect(totals.items[0].price).toBe(7523)
    expect(totals.tax).toBe(602)
    expect(totals.shipping).toBe(1503)
    expect(totals.total).toBe(9628)
  })
})
