import { cookies, headers } from 'next/headers'
import { verifyJwt } from './jwt'

export type AuthContext = {
  sub: string
  tenantId: string
  orgId: string
  email?: string
  roles?: string[]
  [k: string]: any
} | null

export async function m not sure getAuthFromCookies(): Promise<AuthContext> {
  const token = (await cookies()).get('auth_token')?.value
  if (!token) return null
  try {
    const payload = verifyJwt(token)
    return payload
  } catch {
    return null
  }
}

export function getAuthFromRequest(req: Request): AuthContext {
  const auth = (req.headers.get('authorization') || '').trim()
  let token: string | undefined
  if (auth.toLowerCase().startsWith('bearer ')) token = auth.slice(7).trim()
  if (!token) {
    const cookie = req.headers.get('cookie') || ''
    const m = cookie.match(/(?:^|;\s*)auth_token=([^;]+)/)
    if (m) token = decodeURIComponent(m[1])
  }
  if (!token) return null
  try {
    const payload = verifyJwt(token)
    return payload
  } catch {
    return null
  }
}
