import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { buildSafeRedirectResponse, resolveTrustedRedirectBase } from '@open-mercato/core/modules/auth/lib/requestRedirect'
import { sanitizeRedirectPath } from '@open-mercato/core/modules/auth/lib/safeRedirect'
import { resolveAutoLoginCredentials } from '@open-mercato/core/modules/auth/lib/autologin'
import { emitAuthEvent } from '@open-mercato/core/modules/auth/events'

export const metadata = { requireAuth: false }

const accessTokenMaxAgeSeconds = 60 * 60 * 8

// Demo-only convenience: when OM_AUTOLOGIN_* credentials are configured, sign the
// visitor in with those credentials and redirect into the app. Gated entirely
// behind env vars — the homepage only routes here when they are set. On any
// failure (feature off, bad credentials) it falls back to the manual login form
// so a misconfigured demo can never loop.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const baseUrl = resolveTrustedRedirectBase(req) ?? url.origin
  const redirectTo = sanitizeRedirectPath(url.searchParams.get('redirect'), baseUrl, '/backend')

  const credentials = resolveAutoLoginCredentials()
  if (!credentials) {
    return buildSafeRedirectResponse(req, '/login')
  }

  // Already signed in — go straight to the app instead of re-issuing a session.
  const existing = await getAuthFromRequest(req)
  if (existing) {
    return buildSafeRedirectResponse(req, redirectTo)
  }

  const container = await createRequestContainer()
  const auth = container.resolve<AuthService>('authService')

  let user = null
  if (credentials.tenantId) {
    user = await auth.findUserByEmailAndTenant(credentials.email, credentials.tenantId)
  } else {
    const users = await auth.findUsersByEmail(credentials.email)
    user = users.length === 1 ? users[0] : null
  }

  const ok = await auth.verifyPassword(user, credentials.password)
  if (!user || !ok) {
    // Misconfigured demo credentials — never loop; drop to the manual form.
    console.warn('[autologin] OM_AUTOLOGIN credentials did not resolve to a single valid user; falling back to /login')
    return buildSafeRedirectResponse(req, '/login')
  }

  const resolvedTenantId = credentials.tenantId ?? (user.tenantId ? String(user.tenantId) : null)
  const roles = await auth.getUserRoles(user, resolvedTenantId)
  await auth.updateLastLoginAt(user)
  const expiresAt = new Date(Date.now() + accessTokenMaxAgeSeconds * 1000)
  const { session } = await auth.createSession(user, expiresAt)
  const token = signJwt({
    sub: String(user.id),
    sid: String(session.id),
    tenantId: resolvedTenantId,
    orgId: user.organizationId ? String(user.organizationId) : null,
    email: user.email,
    roles,
  })
  void emitAuthEvent('auth.login.success', {
    id: String(user.id),
    email: user.email,
    tenantId: resolvedTenantId,
    organizationId: user.organizationId ? String(user.organizationId) : null,
  }).catch(() => undefined)

  const res = buildSafeRedirectResponse(req, redirectTo)
  res.cookies.set('auth_token', token, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: accessTokenMaxAgeSeconds,
  })
  return res
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Demo autologin',
  methods: {
    GET: {
      summary: 'Auto sign-in using env-configured demo credentials',
      description:
        'When OM_AUTOLOGIN_EMAIL / OM_AUTOLOGIN_PASSWORD are configured, signs the visitor in with those credentials and redirects into the app. Intended for single-tenant demo instances only. Falls back to the login page when disabled or misconfigured.',
      responses: [
        { status: 307, description: 'Redirect into the app (or to /login on failure)', mediaType: 'text/html' },
      ],
    },
  },
}
