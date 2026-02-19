import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { toAbsoluteUrl } from '@open-mercato/shared/lib/url'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SsoService } from '../../services/ssoService'
import { ssoInitiateSchema } from '../../data/validators'
import { emitSsoEvent } from '../../events'

function sanitizeReturnUrl(raw: string | null): string {
  const value = raw || '/backend'
  if (!value.startsWith('/') || value.startsWith('//')) return '/backend'
  try {
    const parsed = new URL(value, 'http://localhost')
    if (parsed.origin !== 'http://localhost') return '/backend'
    return parsed.pathname + parsed.search + parsed.hash
  } catch {
    return '/backend'
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const configId = url.searchParams.get('configId')
    const rawReturnUrl = url.searchParams.get('returnUrl')

    const parsed = ssoInitiateSchema.safeParse({ configId, returnUrl: rawReturnUrl ?? undefined })
    if (!parsed.success || !parsed.data.configId) {
      return NextResponse.redirect(toAbsoluteUrl(req, '/login?error=sso_missing_config'))
    }

    const returnUrl = sanitizeReturnUrl(rawReturnUrl)
    const redirectUri = toAbsoluteUrl(req, '/api/sso/callback/oidc')
    const container = await createRequestContainer()
    const ssoService = container.resolve<SsoService>('ssoService')

    const { redirectUrl, stateCookie } = await ssoService.initiateLogin(parsed.data.configId, returnUrl, redirectUri)

    const res = NextResponse.redirect(redirectUrl)
    res.cookies.set('sso_state', stateCookie, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 300,
    })
    return res
  } catch (err) {
    void emitSsoEvent('sso.login.failed', {
      reason: err instanceof Error ? err.message : 'initiate_failed',
    }).catch(() => undefined)
    return NextResponse.redirect(toAbsoluteUrl(req, '/login?error=sso_failed'))
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SSO',
  summary: 'Initiate SSO login',
  methods: {
    GET: {
      summary: 'Start SSO login flow',
      description: 'Redirects the browser to the configured IdP authorization endpoint. Sets an encrypted sso_state cookie for CSRF protection.',
      tags: ['SSO'],
      responses: [
        { status: 302, description: 'Redirect to IdP authorization endpoint', mediaType: 'text/html' },
      ],
    },
  },
}
