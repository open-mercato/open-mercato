import { DEFAULT_CART_PRICE_STALENESS_MINUTES, detectCartRepriceTrigger, resolveCartPriceStalenessMs } from '../triggers'
import type { CartStoredPricingContext } from '../triggers'

function makeStored(overrides: Partial<CartStoredPricingContext> = {}): CartStoredPricingContext {
  return {
    channel: 'storefront',
    buyerDigest: 'digest-1',
    currencyCode: 'USD',
    locale: 'en-US',
    totalsComputedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('resolveCartPriceStalenessMs', () => {
  const originalEnv = process.env.CART_PRICE_STALENESS_MINUTES

  afterEach(() => {
    process.env.CART_PRICE_STALENESS_MINUTES = originalEnv
  })

  it('defaults to 30 minutes when unset', () => {
    delete process.env.CART_PRICE_STALENESS_MINUTES
    expect(resolveCartPriceStalenessMs()).toBe(DEFAULT_CART_PRICE_STALENESS_MINUTES * 60 * 1000)
  })

  it('honors a valid env override', () => {
    process.env.CART_PRICE_STALENESS_MINUTES = '10'
    expect(resolveCartPriceStalenessMs()).toBe(10 * 60 * 1000)
  })

  it('falls back to the default for an invalid/too-small override', () => {
    process.env.CART_PRICE_STALENESS_MINUTES = '0'
    expect(resolveCartPriceStalenessMs()).toBe(DEFAULT_CART_PRICE_STALENESS_MINUTES * 60 * 1000)
    process.env.CART_PRICE_STALENESS_MINUTES = 'not-a-number'
    expect(resolveCartPriceStalenessMs()).toBe(DEFAULT_CART_PRICE_STALENESS_MINUTES * 60 * 1000)
  })
})

describe('detectCartRepriceTrigger', () => {
  const now = new Date('2026-01-01T00:10:00.000Z') // 10 minutes after totalsComputedAt — inside the 30 min budget

  it('returns null when nothing differs and the cart is fresh (TC-CART-PRICE-01 — no trigger outside the set)', () => {
    const stored = makeStored()
    const fresh = { buyerDigest: 'digest-1', currencyCode: 'USD', locale: 'en-US' }
    expect(detectCartRepriceTrigger(stored, fresh, now)).toBeNull()
  })

  it('trigger 2: buyer_context_changed when the digest differs on a storefront cart', () => {
    const stored = makeStored()
    const fresh = { buyerDigest: 'digest-2', currencyCode: 'USD', locale: 'en-US' }
    expect(detectCartRepriceTrigger(stored, fresh, now)).toEqual({ reason: 'buyer_context_changed' })
  })

  it('trigger 3: currency_changed when the currency differs on a storefront cart', () => {
    const stored = makeStored()
    const fresh = { buyerDigest: 'digest-1', currencyCode: 'EUR', locale: 'en-US' }
    expect(detectCartRepriceTrigger(stored, fresh, now)).toEqual({ reason: 'currency_changed' })
  })

  it('trigger 3: locale_changed when only the locale differs on a storefront cart', () => {
    const stored = makeStored()
    const fresh = { buyerDigest: 'digest-1', currencyCode: 'USD', locale: 'de-DE' }
    expect(detectCartRepriceTrigger(stored, fresh, now)).toEqual({ reason: 'locale_changed' })
  })

  it('precedence: buyer identity outranks currency and locale when more than one differs at once', () => {
    const stored = makeStored()
    const fresh = { buyerDigest: 'digest-2', currencyCode: 'EUR', locale: 'de-DE' }
    expect(detectCartRepriceTrigger(stored, fresh, now)).toEqual({ reason: 'buyer_context_changed' })
  })

  it('trigger 4: stale_snapshot when totalsComputedAt is at or past the staleness budget', () => {
    const stored = makeStored()
    const fresh = { buyerDigest: 'digest-1', currencyCode: 'USD', locale: 'en-US' }
    const staleNow = new Date(stored.totalsComputedAt.getTime() + resolveCartPriceStalenessMs())
    expect(detectCartRepriceTrigger(stored, fresh, staleNow)).toEqual({ reason: 'stale_snapshot' })
  })

  it('trigger 4 never fires one millisecond before the budget elapses', () => {
    const stored = makeStored()
    const fresh = { buyerDigest: 'digest-1', currencyCode: 'USD', locale: 'en-US' }
    const justBefore = new Date(stored.totalsComputedAt.getTime() + resolveCartPriceStalenessMs() - 1)
    expect(detectCartRepriceTrigger(stored, fresh, justBefore)).toBeNull()
  })

  it('triggers 2/3 never fire for a non-storefront cart, even when the digest/currency/locale all differ', () => {
    const stored = makeStored({ channel: 'pos', buyerDigest: '', currencyCode: 'USD', locale: 'en-US' })
    const fresh = { buyerDigest: 'digest-from-an-unrelated-storefront-visitor', currencyCode: 'EUR', locale: 'de-DE' }
    expect(detectCartRepriceTrigger(stored, fresh, now)).toBeNull()
  })

  it('trigger 4 still fires for a non-storefront cart once stale, since staleness is purely time-based', () => {
    const stored = makeStored({ channel: 'pos', buyerDigest: '', currencyCode: 'USD', locale: 'en-US' })
    const fresh = { buyerDigest: 'irrelevant', currencyCode: 'EUR', locale: 'de-DE' }
    const staleNow = new Date(stored.totalsComputedAt.getTime() + resolveCartPriceStalenessMs())
    expect(detectCartRepriceTrigger(stored, fresh, staleNow)).toEqual({ reason: 'stale_snapshot' })
  })
})
