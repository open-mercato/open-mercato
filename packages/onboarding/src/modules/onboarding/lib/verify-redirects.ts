import { NextResponse } from 'next/server'

const TENANT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 14

function clearAuthCookies(response: NextResponse) {
  response.cookies.set('auth_token', '', { path: '/', maxAge: 0 })
  response.cookies.set('session_token', '', { path: '/', maxAge: 0 })
  response.cookies.set('om_login_tenant', '', { path: '/', maxAge: 0 })
}

function setTenantCookie(response: NextResponse, tenantId: string) {
  response.cookies.set('om_login_tenant', tenantId, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TENANT_COOKIE_MAX_AGE_SECONDS,
  })
}

export function redirectWithStatus(baseUrl: string, status: string) {
  return NextResponse.redirect(`${baseUrl}/onboarding?status=${encodeURIComponent(status)}`)
}

export function redirectToPreparing(baseUrl: string, tenantId: string | null) {
  const tenantParam = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : ''
  const response = NextResponse.redirect(`${baseUrl}/onboarding/preparing${tenantParam}`)
  clearAuthCookies(response)
  if (tenantId) {
    setTenantCookie(response, tenantId)
  }
  return response
}

export function redirectToLogin(baseUrl: string, tenantId: string | null) {
  const tenantParam = tenantId ? `?tenant=${encodeURIComponent(tenantId)}` : ''
  const response = NextResponse.redirect(`${baseUrl}/login${tenantParam}`)
  clearAuthCookies(response)
  if (tenantId) {
    setTenantCookie(response, tenantId)
  }
  return response
}
