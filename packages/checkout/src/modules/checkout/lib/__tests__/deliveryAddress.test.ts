import { hashAddressForCache, hashCartLinesForCache, resolveDestinationAddress } from '../deliveryAddress'

describe('resolveDestinationAddress', () => {
  it('returns null when the shipping address is absent', () => {
    expect(resolveDestinationAddress(null)).toBeNull()
    expect(resolveDestinationAddress(undefined)).toBeNull()
  })

  it('returns null when a required field is missing', () => {
    expect(resolveDestinationAddress({ countryCode: 'US', postalCode: '10001', city: 'NYC' })).toBeNull()
  })

  it('narrows a loosely-shaped buyer-supplied address into the carrier shape', () => {
    const result = resolveDestinationAddress({
      country: 'US',
      zip: '10001',
      city: 'New York',
      street: '5th Ave',
    })
    expect(result).toEqual({ countryCode: 'US', postalCode: '10001', city: 'New York', line1: '5th Ave' })
  })

  it('includes line2 only when present', () => {
    const result = resolveDestinationAddress({
      countryCode: 'US',
      postalCode: '10001',
      city: 'New York',
      line1: '5th Ave',
      line2: 'Apt 4',
    })
    expect(result).toEqual({
      countryCode: 'US',
      postalCode: '10001',
      city: 'New York',
      line1: '5th Ave',
      line2: 'Apt 4',
    })
  })
})

describe('cache key hashing', () => {
  const address = { countryCode: 'US', postalCode: '10001', city: 'New York', line1: '5th Ave' }

  it('is stable for the same address and changes for a different one', () => {
    expect(hashAddressForCache(address)).toBe(hashAddressForCache({ ...address }))
    expect(hashAddressForCache(address)).not.toBe(hashAddressForCache({ ...address, postalCode: '10002' }))
  })

  it('cart-line hashing is order-independent but quantity/line-sensitive', () => {
    const linesA = [
      { lineId: 'a', productId: 'p1', variantId: null, quantity: '1' },
      { lineId: 'b', productId: 'p2', variantId: null, quantity: '2' },
    ]
    const linesB = [linesA[1], linesA[0]]
    expect(hashCartLinesForCache(linesA)).toBe(hashCartLinesForCache(linesB))

    const linesChanged = [linesA[0], { ...linesA[1], quantity: '3' }]
    expect(hashCartLinesForCache(linesA)).not.toBe(hashCartLinesForCache(linesChanged))
  })
})
