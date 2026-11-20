/** @jest-environment node */
import { createHash, randomBytes } from 'node:crypto'
import { createPkcePair } from '../pkce'

jest.mock('node:crypto', () => {
  const actual = jest.requireActual<typeof import('node:crypto')>('node:crypto')
  return { ...actual, randomBytes: jest.fn((size: number) => actual.randomBytes(size)) }
})

const RFC_7636_APPENDIX_B_OCTETS = [
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240,
  91, 88, 5, 88, 83, 132, 141, 121,
]

describe('createPkcePair', () => {
  it('matches the RFC 7636 Appendix B vector', () => {
    const mockedRandomBytes = randomBytes as unknown as jest.Mock<Buffer, [number]>
    mockedRandomBytes.mockReturnValueOnce(Buffer.from(RFC_7636_APPENDIX_B_OCTETS))

    expect(createPkcePair()).toEqual({
      codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      method: 'S256',
    })
    expect(mockedRandomBytes).toHaveBeenLastCalledWith(32)
  })

  it('returns a fresh 43-character base64url verifier with its S256 challenge', () => {
    const first = createPkcePair()
    const second = createPkcePair()

    expect(first.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.codeVerifier).not.toBe(second.codeVerifier)
    expect(first.codeChallenge).toBe(createHash('sha256').update(first.codeVerifier).digest('base64url'))
  })
})
