export async function getAuthFromCookies(): Promise<AuthContext> {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()
  const token = cookieStore.get('auth_token')?.value
  if (!token) return null
  try {
    const payload = verifyJwt(token) as AuthContext
    if (!payload) return null
    const tenantCookie = cookieStore.get(TENANT_COOKIE_NAME)?.value
    const orgCookie = cookieStore.get(ORGANIZATION_COOKIE_NAME)?.value
    return applySuperAdminScope(payload, tenantCookie, orgCookie)
  } catch {
    return null
  }
}

export async function getAuthFromRequest(req: Request): Promise<AuthContext> {
  const cookieHeader = req.headers.get('cookie') || ''
  const tenantCookie = readCookieFromHeader(cookieHeader, TENANT_COOKIE_NAME)
  const orgCookie = readCookieFromHeader(cookieHeader, ORGANIZATION_COOKIE_NAME)
  const authHeader = (req.headers.get('authorization') || '').trim()
  let token: string | undefined
  if (authHeader.toLowerCase().startsWith('bearer ')) token = authHeader.slice(7).trim()
  if (!token) {
    const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/)
    if (match) token = decodeURIComponent(match[1])
  }
  if (token) {
    try {
      const payload = verifyJwt(token) as AuthContext
      if (payload) return applySuperAdminScope(payload, tenantCookie, orgCookie)
    } catch {
      // fall back to API key detection
    }
  }

  const apiKey = extractApiKey(req)
  if (!apiKey) return null
  const apiAuth = await resolveApiKeyAuth(apiKey)
  if (!apiAuth) return null
  return applySuperAdminScope(apiAuth, tenantCookie, orgCookie)
}
