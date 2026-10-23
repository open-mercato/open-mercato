import { XERO_STATE_COOKIE } from './constants'

type CookieWriter = {
  cookies: {
    set(options: { name: string; value: string; httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number }): unknown
  }
}

export function readXeroStateCookie(req: Request): string | null {
  const header = req.headers.get('cookie')
  if (!header) return null
  for (const segment of header.split(';')) {
    const trimmed = segment.trim()
    if (!trimmed.startsWith(`${XERO_STATE_COOKIE}=`)) continue
    try {
      return decodeURIComponent(trimmed.slice(XERO_STATE_COOKIE.length + 1))
    } catch {
      return null
    }
  }
  return null
}

export function setXeroStateCookie(response: CookieWriter, value: string, expiresAt: number): void {
  response.cookies.set({
    name: XERO_STATE_COOKIE,
    value,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
  })
}

export function clearXeroStateCookie(response: CookieWriter): void {
  response.cookies.set({
    name: XERO_STATE_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}
