import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { toAbsoluteUrl } from '@open-mercato/shared/lib/url'
import { getChannelAdapter } from '../../../../../lib/adapter-registry-singleton'
import { resolveOAuthClientCredentials } from '../../../../../lib/oauth-client-config'
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
  /** Optional pre-filled email — Google `login_hint`. */
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
  // Derive the origin from the configured app URL / forwarded headers rather
  // than the raw request origin, so the redirect_uri matches the value the
  // provider has registered even when the app sits behind a reverse proxy.
  return toAbsoluteUrl(req, `/api/communication_channels/oauth/${providerKey}/callback`)
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
    const json = await readJsonSafe(req, {})
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
  // OAuth client credentials are tenant-level — the admin configures them under
  // the `channel_<provider>` integration in the Integrations UI (stored at
  // userId = null). A missing row means the provider has not been set up yet;
  // we surface that as an actionable error instead of handing an empty object to
  // the adapter (which would throw a cryptic Zod "expected string" message).
  const credentials = await resolveOAuthClientCredentials(credentialsService, provider, {
    tenantId: auth.tenantId as string,
    organizationId: (auth as { orgId?: string | null }).orgId ?? null,
  })
  if (!credentials) {
    return NextResponse.json(
      {
        error:
          `${provider} is not configured for this workspace yet. An administrator must add the OAuth Client ID and Secret under Integrations before mailboxes can be connected.`,
        code: 'oauth_client_not_configured',
      },
      { status: 409 },
    )
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
