import { generateCartToken, hashCartToken } from '../token'

describe('cart token lib', () => {
  it('never generates the same token twice (collision sanity, not a proof)', () => {
    const first = generateCartToken()
    const second = generateCartToken()
    expect(first.token).not.toBe(second.token)
  })

  it('re-hashes a generated token to the same tokenHash it was created with', () => {
    const generated = generateCartToken()
    expect(hashCartToken(generated.token)).toBe(generated.tokenHash)
  })

  it('never equals its own hash (sanity that hashing actually transforms the value)', () => {
    const generated = generateCartToken()
    expect(generated.token).not.toBe(generated.tokenHash)
  })
})
