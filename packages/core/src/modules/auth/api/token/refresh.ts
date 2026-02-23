import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkAuthRateLimit } from '@open-mercato/core/modules/auth/lib/rateLimitCheck'

const refreshIpRateLimitConfig = readEndpointRateLimitConfig('TOKEN_REFRESH_IP', {
  points: 30,
  duration: 60,
  blockDuration: 60,
  keyPrefix: 'token-refresh-ip',
})

export const metadata = {
  POST: { requireAuth: false },
}

function parseCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie') || ''
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'))
  return m ? decodeURIComponent(m[1]) : null
}

async function extractRefreshToken(req: Request): Promise<string | null> {
  try {
    const body = await req.clone().json()
    if (body?.refreshToken && typeof body.refreshToken === 'string') {
      return body.refreshToken.trim()
    }
  } catch {
    // Body not JSON or empty
  }
  return parseCookie(req, 'session_token')
}

export async function POST(req: Request) {
  const { translate } = await resolveTranslations()
  const { error: rateLimitError } = await checkAuthRateLimit({
    req,
    ipConfig: refreshIpRateLimitConfig,
    compoundConfig: undefined,
    compoundIdentifier: undefined,
  })
  if (rateLimitError) return rateLimitError

  const refreshToken = await extractRefreshToken(req)
  if (!refreshToken) {
    return NextResponse.json(
      { ok: false, error: translate('auth.refresh.errors.tokenRequired', 'Refresh token is required') },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const auth = container.resolve<AuthService>('authService')
  const ctx = await auth.refreshFromSessionToken(refreshToken)
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: translate('auth.refresh.errors.invalidToken', 'Invalid or expired refresh token') },
      { status: 401 },
    )
  }

  const { user, roles } = ctx
  const expiresInSec = 60 * 60 * 8
  const accessToken = signJwt(
    {
      sub: String(user.id),
      tenantId: user.tenantId ? String(user.tenantId) : null,
      orgId: user.organizationId ? String(user.organizationId) : null,
      email: user.email,
      roles,
    },
    undefined,
    expiresInSec,
  )

  return NextResponse.json({
    ok: true,
    accessToken,
    expiresIn: expiresInSec,
  })
}

const refreshRequestSchema = z.object({
  refreshToken: z.string().min(32).describe('The refresh token obtained from login'),
})

const refreshSuccessSchema = z.object({
  ok: z.literal(true),
  accessToken: z.string().describe('New JWT access token'),
  expiresIn: z.number().describe('Token validity in seconds'),
})

const refreshErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
})

const refreshMethodDoc: OpenApiMethodDoc = {
  summary: 'Refresh access token',
  description: `Exchanges a valid refresh token for a new access token.

The refresh token can be provided via:
1. JSON body: \`{ "refreshToken": "..." }\`
2. Cookie: \`session_token\` (fallback for browser/mixed-mode clients)

This endpoint is designed for mobile apps and API clients.`,
  tags: ['Authentication & Accounts'],
  requestBody: {
    schema: refreshRequestSchema,
    description: 'JSON body with refresh token',
  },
  responses: [
    {
      status: 200,
      description: 'Token refreshed successfully',
      schema: refreshSuccessSchema,
    },
  ],
  errors: [
    { status: 400, description: 'No refresh token provided', schema: refreshErrorSchema },
    { status: 401, description: 'Invalid or expired refresh token', schema: refreshErrorSchema },
    { status: 429, description: 'Too many refresh attempts', schema: rateLimitErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Token refresh',
  description: 'API-friendly token refresh for mobile and API clients.',
  methods: {
    POST: refreshMethodDoc,
  },
}
