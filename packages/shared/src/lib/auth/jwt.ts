import crypto from 'node:crypto'

function base64url(input: Buffer | string) {
  return (typeof input === 'string' ? Buffer.from(input) : input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

export type JwtPayload = Record<string, any>

export function signJwt(payload: JwtPayload, secret = process.env.JWT_SECRET!, expiresInSec = 60 * 60 * 8) {
  if (!secret) throw new Error('JWT_SECRET is not set')
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body = { iat: now, exp: now + expiresInSec, ...payload }
  const encHeader = base64url(JSON.stringify(header))
  const encBody = base64url(JSON.stringify(body))
  const data = `${encHeader}.${encBody}`
  const sig = crypto.createHmac('sha256', secret).update(data).digest()
  const encSig = base64url(sig)
  return `${data}.${encSig}`
}

export function verifyJwt(token: string, secret = process.env.JWT_SECRET!) {
  if (!secret) throw new Error('JWT_SECRET is not set')
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts
  const data = `${h}.${p}`
  const expected = base64url(crypto.createHmac('sha256', secret).update(data).digest())
  if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null
  const payload = JSON.parse(Buffer.from(p, 'base64').toString('utf8'))
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && now > payload.exp) return null
  return payload
}

