import { hashOpaqueToken } from '@open-mercato/shared/lib/security/token'

describe('hashOpaqueToken', () => {
  it('returns a deterministic sha256 hex digest', () => {
    expect(hashOpaqueToken('secret-token')).toBe(hashOpaqueToken('secret-token'))
    expect(hashOpaqueToken('secret-token')).toMatch(/^[a-f0-9]{64}$/)
  })

  it('does not return the raw token', () => {
    expect(hashOpaqueToken('secret-token')).not.toBe('secret-token')
  })
})
