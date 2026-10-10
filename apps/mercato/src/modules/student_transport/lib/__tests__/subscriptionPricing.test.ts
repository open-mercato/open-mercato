/** @jest-environment node */
import { computePeriodCharge, periodsInWindow, resolvePeriodPrice } from '../subscriptionPricing'
import { legsForDirection, toTripDateString } from '../dates'

describe('subscription pricing', () => {
  // The direction picks the price: a round trip bills the two-way price, a
  // one-way rider the single-leg price.
  it('resolves the plan price from the direction', () => {
    const plan = { priceTwoWay: '900', priceOneWay: '520' }
    expect(resolvePeriodPrice('two_way', plan)).toBe('900.00')
    expect(resolvePeriodPrice('one_way_pickup', plan)).toBe('520.00')
    expect(resolvePeriodPrice('one_way_drop', plan)).toBe('520.00')
  })

  it('treats a missing or nonsense price as zero', () => {
    expect(resolvePeriodPrice('two_way', { priceTwoWay: null, priceOneWay: '10' })).toBe('0.00')
    expect(resolvePeriodPrice('two_way', { priceTwoWay: '-5', priceOneWay: '10' })).toBe('0.00')
    expect(resolvePeriodPrice('one_way_drop', { priceTwoWay: '900', priceOneWay: 'abc' })).toBe('0.00')
  })

  it('adds VAT to the period price to the halala', () => {
    expect(computePeriodCharge('900', 15)).toEqual({ net: '900.00', tax: '135.00', gross: '1035.00' })
    expect(computePeriodCharge('100', 0)).toEqual({ net: '100.00', tax: '0.00', gross: '100.00' })
  })

  it('counts the billing periods a window covers', () => {
    expect(periodsInWindow('monthly', '2026-01-01', '2026-03-31')).toBe(3)
    expect(periodsInWindow('quarterly', '2026-01-01', '2026-06-30')).toBe(2)
    expect(periodsInWindow('annual', '2026-01-01', '2026-12-31')).toBe(1)
    expect(periodsInWindow('monthly', null, null)).toBe(1)
  })
})

describe('subscription legs and dates', () => {
  it('gives a one-way subscription exactly one leg', () => {
    expect(legsForDirection('two_way')).toEqual(['pickup', 'dropoff'])
    expect(legsForDirection('one_way_pickup')).toEqual(['pickup'])
    expect(legsForDirection('one_way_drop')).toEqual(['dropoff'])
  })

  // A trip day is a calendar day: the stored string is what every reader sees,
  // never shifted by the server's zone.
  it('keeps a trip date a calendar day', () => {
    expect(toTripDateString('2026-10-12')).toBe('2026-10-12')
    expect(toTripDateString('2026-10-12T23:30:00.000Z')).toBe('2026-10-12')
  })
})
