import { NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { toAbsoluteUrl } from '@open-mercato/shared/lib/url'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { SsoService } from '../../../services/ssoService'
import { emitSsoEvent } from '../../../events'

function parseCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : null
}

async function handleCallback(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url)
    const callbackParams: Record<string, string> = {}
    url.searchParams.forEach((value, key) => {
      callbackParams[key] = value
    })

    if (req.method === 'POST') {
      const contentType = req.headers.get('content-type') || ''
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const form = await req.formData()
        form.forEach((value, key) => {
          callbackParams[key] = String(value)
        })
      }
    }

    const stateCookie = parseCookie(req, 'sso_state')
    if (!stateCookie) {
      return NextResponse.redirect(toAbsoluteUrl(req, '/login?error=sso_state_missing'))
    }

    if (callbackParams.error) {
      void emitSsoEvent('sso.login.failed', {
        reason: callbackParams.error,
      }).catch(() => undefined)
      return NextResponse.redirect(toAbsoluteUrl(req, '/login?error=sso_idp_error'))
    }

    if (!callbackParams.code || !callbackParams.state) {
      return NextResponse.redirect(toAbsoluteUrl(req, '/login?error=sso_missing_params'))
    }

    const redirectUri = toAbsoluteUrl(req, '/api/sso/callback/oidc')
    const container = await createRequestContainer()
    const ssoService = container.resolve<SsoService>('ssoService')

    const result = await ssoService.handleOidcCallback(callbackParams, stateCookie, redirectUri)

    const res = NextResponse.redirect(toAbsoluteUrl(req, result.redirectUrl))

    res.cookies.set('auth_token', result.token, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 8,
    })

    res.cookies.set('session_token', result.sessionToken, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: result.sessionExpiresAt,
    })

    res.cookies.set('sso_state', '', { path: '/', maxAge: 0 })

    return res
  } catch (err) {
    console.error('[SSO Callback] Error:', err)
    void emitSsoEvent('sso.login.failed', {
      reason: err instanceof Error ? err.message : 'callback_failed',
    }).catch(() => undefined)
    const message = err instanceof Error ? err.message : ''
    const errorCode = message.includes('email is not verified') ? 'sso_email_not_verified' : 'sso_failed'
    return NextResponse.redirect(toAbsoluteUrl(req, `/login?error=${errorCode}`))
  }
}

export async function GET(req: Request) {
  return handleCallback(req)
}

export async function POST(req: Request) {
  return handleCallback(req)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'SSO',
  summary: 'OIDC callback',
  methods: {
    GET: {
      summary: 'Handle OIDC callback (GET)',
      description: 'Receives the authorization code from the IdP, exchanges it for tokens, resolves the user, and issues auth cookies.',
      tags: ['SSO'],
      responses: [
        { status: 302, description: 'Redirect to application with auth cookies set', mediaType: 'text/html' },
      ],
    },
    POST: {
      summary: 'Handle OIDC callback (POST)',
      description: 'Some IdPs send the callback as a POST (form_post response mode). Handles the same flow as the GET variant.',
      tags: ['SSO'],
      responses: [
        { status: 302, description: 'Redirect to application with auth cookies set', mediaType: 'text/html' },
      ],
    },
  },
}
