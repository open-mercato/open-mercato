import { computeAutopayHash } from '../lib/hash'
import { isValidReturnSignature, readReturnQuery } from '../lib/return-bridge'

const credentials = { serviceId: '2', sharedKey: '2test2' }
const DOCUMENTED_RETURN_HASH = '254eac9980db56f425acf8a9df715cbd6f56de3c410b05f05016630f7d30a4ed'

describe('readReturnQuery', () => {
  it('reads the three parameters Autopay appends to the return address', () => {
    expect(readReturnQuery(new URLSearchParams('ServiceID=2&OrderID=100&Hash=abc'))).toEqual({
      serviceId: '2',
      orderId: '100',
      hash: 'abc',
    })
  })

  it.each(['OrderID=100&Hash=abc', 'ServiceID=2&Hash=abc', 'ServiceID=2&OrderID=100', ''])(
    'returns null when a parameter is missing: %p',
    (query) => {
      expect(readReturnQuery(new URLSearchParams(query))).toBeNull()
    },
  )
})

describe('isValidReturnSignature', () => {
  it('accepts the documented return-redirect example', () => {
    expect(isValidReturnSignature(credentials, { serviceId: '2', orderId: '100', hash: DOCUMENTED_RETURN_HASH })).toBe(true)
  })

  it('accepts an upper-case hash', () => {
    expect(isValidReturnSignature(credentials, {
      serviceId: '2',
      orderId: '100',
      hash: DOCUMENTED_RETURN_HASH.toUpperCase(),
    })).toBe(true)
  })

  it('rejects a hash computed for a different order', () => {
    const otherOrder = computeAutopayHash(['2', '101'], '2test2')
    expect(isValidReturnSignature(credentials, { serviceId: '2', orderId: '100', hash: otherOrder })).toBe(false)
  })

  it('rejects a hash signed with another tenant shared key', () => {
    const foreign = computeAutopayHash(['2', '100'], 'someone-elses-key')
    expect(isValidReturnSignature(credentials, { serviceId: '2', orderId: '100', hash: foreign })).toBe(false)
  })

  it('rejects a service id that is not the configured one', () => {
    const hash = computeAutopayHash(['3', '100'], '2test2')
    expect(isValidReturnSignature(credentials, { serviceId: '3', orderId: '100', hash })).toBe(false)
  })

  it('verifies with sha512 when the tenant is configured for it', () => {
    const hash = computeAutopayHash(['2', '100'], '2test2', 'sha512')
    expect(isValidReturnSignature({ ...credentials, hashAlgorithm: 'sha512' }, { serviceId: '2', orderId: '100', hash })).toBe(true)
    expect(isValidReturnSignature(credentials, { serviceId: '2', orderId: '100', hash })).toBe(false)
  })

  it('fails closed on incomplete credentials', () => {
    expect(isValidReturnSignature({}, { serviceId: '2', orderId: '100', hash: DOCUMENTED_RETURN_HASH })).toBe(false)
    expect(isValidReturnSignature({ serviceId: '2' }, { serviceId: '2', orderId: '100', hash: DOCUMENTED_RETURN_HASH })).toBe(false)
  })
})
