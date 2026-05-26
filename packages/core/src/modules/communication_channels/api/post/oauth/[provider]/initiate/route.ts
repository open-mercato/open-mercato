import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getChannelAdapter } from '../../../../../lib/adapter-registry-singleton'
import {
  COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME,
  COMMUNICATION_CHANNELS_OAUTH_STATE_TTL_MS,
  createOAuthState,
  DEFAULT_OAUTH_RETURN_URL,
  isSafeOAuthReturnUrl,
  normalizeOAuthReturnUrl,
  OAuthStateError,
} from '../../../../../lib/oauth-state'

export const metadata = {
  path: '/communication_channels/oauth/[provider]/initiate',
  POST: {
    requireAuth: true,
    requireFeatures: ['communication_channels.connect_user_channel'],
  },
}

const initiateBodySchema = z.object({
  channelType: z.literal('email').optional(),
  /** Where to send the user after the callback succeeds. Defaults to the profile page. */
  returnUrl: z.string().min(1).max(2048).refine(isSafeOAuthReturnUrl, {
    message: 'returnUrl must be a same-origin path',
  }).optional(),
  /** Optional pre-filled email — Google `login_hint` / Microsoft `login_hint`. */
  loginHint: z.string().email().optional(),
})

type RouteContext = {
  params: Promise<{ provider: string }> | { provider: string }
}

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string },
  ) => Promise<Record<string, unknown> | null>
}

/**
 * Default profile redirect — matches the per-user channels page registered by
 * slice 3d (the `/backend/profile/communication-channels` route).
 */
function defaultRedirectUri(req: Request, providerKey: string): string {
  const url = new URL(req.url)
  url.pathname = `/api/communication_channels/oauth/${providerKey}/callback`
  url.search = ''
  return url.toString()
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  const { provider } = await context.params
  if (!/^[a-z0-9_-]+$/i.test(provider)) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
  }

  const adapter = getChannelAdapter(provider)
  if (!adapter) {
    return NextResponse.json(
      { error: `No ChannelAdapter for provider: ${provider}` },
      { status: 404 },
    )
  }
  if (typeof adapter.buildOAuthAuthorizeUrl !== 'function') {
    return NextResponse.json(
      { error: `Provider '${provider}' does not support OAuth (no buildOAuthAuthorizeUrl)` },
      { status: 400 },
    )
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: z.infer<typeof initiateBodySchema>
  try {
    const json = await req.json().catch(() => ({}))
    body = initiateBodySchema.parse(json ?? {})
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid request body' },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const credentialsService = (() => {
    try {
      return container.resolve('integrationCredentialsService') as CredentialsServiceLike
    } catch {
      return null
    }
  })()
  // OAuth client credentials are tenant-level (the platform-default OAuth app
  // or a tenant-owned override stored under `oauth_<provider>` integration id).
  let credentials: Record<string, unknown> = {}
  if (credentialsService) {
    try {
      credentials =
        (await credentialsService.resolve(`oauth_${provider}`, {
          tenantId: auth.tenantId as string,
          organizationId: (auth as { orgId?: string | null }).orgId ??
            (auth.tenantId as string),
        })) ?? {}
    } catch {
      credentials = {}
    }
  }

  const redirectUri = defaultRedirectUri(req, provider)
  const stateEnvelope = createOAuthState({
    userId: auth.sub as string,
    tenantId: auth.tenantId as string,
    organizationId: (auth as { orgId?: string | null }).orgId ?? null,
    providerKey: provider,
    returnUrl: normalizeOAuthReturnUrl(body.returnUrl, DEFAULT_OAUTH_RETURN_URL),
  })

  let result
  try {
    result = await adapter.buildOAuthAuthorizeUrl({
      state: stateEnvelope.stateParam,
      nonce: stateEnvelope.payload.nonce,
      redirectUri,
      credentials,
      scope: {
        tenantId: auth.tenantId as string,
        organizationId:
          (auth as { orgId?: string | null }).orgId ?? (auth.tenantId as string),
      },
      loginHint: body.loginHint,
    })
  } catch (err) {
    if (err instanceof OAuthStateError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 500 })
    }
    const message = err instanceof Error ? err.message : 'Failed to build OAuth authorize URL'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // If the adapter packed extras (PKCE verifier, scopes), bake them into the
  // state cookie now so the callback handler can pass them to exchangeOAuthCode.
  const finalCookie = result.extra
    ? (await import('../../../../../lib/oauth-state')).encryptOAuthState({
        ...stateEnvelope.payload,
        extra: { ...(stateEnvelope.payload.extra ?? {}), ...result.extra },
      })
    : stateEnvelope.cookie

  const response = NextResponse.json({ authorizeUrl: result.authorizeUrl })
  response.cookies.set({
    name: COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME,
    value: finalCookie,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(COMMUNICATION_CHANNELS_OAUTH_STATE_TTL_MS / 1000),
  })
  return response
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    POST: {
      summary: 'Start a per-user channel OAuth flow',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 200, description: 'Authorize URL + state cookie set' },
        { status: 400, description: 'Invalid provider or unsupported (no OAuth)' },
        { status: 401, description: 'Unauthorized' },
        { status: 422, description: 'Invalid request body' },
        { status: 502, description: 'Adapter failed to build authorize URL' },
      ],
    },
  },
}
export default POST
