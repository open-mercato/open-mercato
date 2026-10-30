import {
  MINIMUM_DROP_PERCENT,
  NOTIFY_COOLDOWN_DAYS,
  decidePriceDrop,
  nextReferencePrice,
} from '../engine/price-watch'

const now = new Date('2026-09-29T12:00:00.000Z')

describe('decidePriceDrop', () => {
  it('fires on a real drop and reports whole percent', () => {
    const decision = decidePriceDrop({ watchedPriceGross: '100.0000', currentPriceGross: '77.0000', notifiedAt: null, now })
    expect(decision).toEqual({ fire: true, previous: 100, current: 77, dropPercent: 23 })
  })

  it('ignores a drop below the threshold, because that is rounding and tax, not a sale', () => {
    const decision = decidePriceDrop({ watchedPriceGross: '100', currentPriceGross: '99', notifiedAt: null, now })
    expect(decision).toEqual({ fire: false, reason: 'too_small' })
    // And fires exactly at the boundary, so the constant means what it says.
    expect(decidePriceDrop({ watchedPriceGross: '100', currentPriceGross: String(100 - MINIMUM_DROP_PERCENT), notifiedAt: null, now }).fire).toBe(true)
  })

  it('does not treat a missing current price as a drop', () => {
    // A product that was unpublished has not become cheaper, and "it is gone" is not the message asked for.
    for (const currentPriceGross of [null, undefined, '', '0']) {
      expect(decidePriceDrop({ watchedPriceGross: '100', currentPriceGross, notifiedAt: null, now }))
        .toEqual({ fire: false, reason: 'no_current_price' })
    }
  })

  it('cannot fire without a reference price', () => {
    expect(decidePriceDrop({ watchedPriceGross: null, currentPriceGross: '50', notifiedAt: null, now }))
      .toEqual({ fire: false, reason: 'no_reference_price' })
  })

  it('does not fire when the price rose or held', () => {
    expect(decidePriceDrop({ watchedPriceGross: '100', currentPriceGross: '100', notifiedAt: null, now }).fire).toBe(false)
    expect(decidePriceDrop({ watchedPriceGross: '100', currentPriceGross: '120', notifiedAt: null, now }))
      .toEqual({ fire: false, reason: 'not_cheaper' })
  })

  it('stays quiet inside the cooldown, however big the drop', () => {
    const yesterday = new Date(now.getTime() - 86_400_000)
    expect(decidePriceDrop({ watchedPriceGross: '100', currentPriceGross: '10', notifiedAt: yesterday, now }))
      .toEqual({ fire: false, reason: 'cooling_down' })
  })

  it('fires again once the cooldown has passed', () => {
    const old = new Date(now.getTime() - (NOTIFY_COOLDOWN_DAYS + 1) * 86_400_000)
    expect(decidePriceDrop({ watchedPriceGross: '100', currentPriceGross: '80', notifiedAt: old, now }).fire).toBe(true)
  })
})

describe('nextReferencePrice', () => {
  it('after firing, measures the next drop from what the customer was just told', () => {
    const decision = decidePriceDrop({ watchedPriceGross: '100', currentPriceGross: '70', notifiedAt: null, now })
    expect(nextReferencePrice(decision, '100', '70')).toBe('70')
  })

  it('follows the price upwards, so a recovery is not announced as a drop', () => {
    /**
     * Somebody who started watching at 100 and saw it rise to 120 should be told when it comes back to 100 —
     * not congratulated for reaching 114, which is what keeping the old reference would do.
     */
    const decision = decidePriceDrop({ watchedPriceGross: '100', currentPriceGross: '120', notifiedAt: null, now })
    expect(nextReferencePrice(decision, '100', '120')).toBe('120')
  })

  it('keeps the reference when the price is merely too small a drop', () => {
    const decision = decidePriceDrop({ watchedPriceGross: '100', currentPriceGross: '99', notifiedAt: null, now })
    expect(nextReferencePrice(decision, '100', '99')).toBe('100')
  })

  it('keeps the reference when the product has no price at all', () => {
    const decision = decidePriceDrop({ watchedPriceGross: '100', currentPriceGross: null, notifiedAt: null, now })
    expect(nextReferencePrice(decision, '100', null)).toBe('100')
  })

  it('adopts the first price it ever sees for a watch that started without one', () => {
    const decision = decidePriceDrop({ watchedPriceGross: null, currentPriceGross: '80', notifiedAt: null, now })
    expect(nextReferencePrice(decision, null, '80')).toBe('80')
  })
})
