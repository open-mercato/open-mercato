import crypto from 'node:crypto'

import { signJwt, verifyJwt } from '../jwt'

function base64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function signTokenParts(header: string, payload: string, secret: string): string {
  return base64url(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest())
}

describe('jwt helpers', () => {
  const secret = 'test-secret'
  const now = new Date('2026-04-11T12:00:00.000Z')

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now.getTime())
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('signs and verifies payloads with issued and expiry timestamps', () => {
    const token = signJwt({ sub: 'user-1', roles: ['admin'] }, secret, 300)

    expect(verifyJwt(token, secret)).toEqual({
      sub: 'user-1',
      roles: ['admin'],
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(now.getTime() / 1000) + 300,
    })
  })

  it('rejects tokens with tampered payloads', () => {
    const token = signJwt({ sub: 'user-1' }, secret, 300)
    const [header, , signature] = token.split('.')
    const tamperedPayload = base64url(
      JSON.stringify({
        sub: 'user-2',
        iat: Math.floor(now.getTime() / 1000),
        exp: Math.floor(now.getTime() / 1000) + 300,
      })
    )

    expect(verifyJwt(`${header}.${tamperedPayload}.${signature}`, secret)).toBeNull()
  })

  it('rejects expired tokens', () => {
    const token = signJwt({ sub: 'user-1' }, secret, 1)

    jest.spyOn(Date, 'now').mockReturnValue(now.getTime() + 3_000)

    expect(verifyJwt(token, secret)).toBeNull()
  })

  it('returns null for malformed signatures', () => {
    const token = signJwt({ sub: 'user-1' }, secret, 300)
    const [header, payload] = token.split('.')

    expect(verifyJwt(`${header}.${payload}.x`, secret)).toBeNull()
  })

  it('returns null for signed payloads that are not valid JSON', () => {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = base64url('not-json')
    const signature = signTokenParts(header, payload, secret)

    expect(verifyJwt(`${header}.${payload}.${signature}`, secret)).toBeNull()
  })

  it('throws when the JWT secret is missing', () => {
    expect(() => signJwt({ sub: 'user-1' }, '')).toThrow('JWT_SECRET is not set')
    expect(() => verifyJwt('header.payload.signature', '')).toThrow('JWT_SECRET is not set')
  })
})
