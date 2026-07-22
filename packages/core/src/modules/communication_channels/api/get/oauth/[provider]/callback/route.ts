import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { toAbsoluteUrl } from '@open-mercato/shared/lib/url'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createConnectedChannelRow, MailboxAlreadyConnectedError } from '../../../../../lib/connect-channel'
import { getChannelAdapter } from '../../../../../lib/adapter-registry-singleton'
import { resolveOAuthClientCredentials } from '../../../../../lib/oauth-client-config'
import {
  COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME,
  DEFAULT_OAUTH_RETURN_URL,
  normalizeOAuthReturnUrl,
  OAuthStateError,
  verifyOAuthState,
} from '../../../../../lib/oauth-state'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('communication_channels').child({ component: 'oauth-callback' })

export const metadata = {
  path: '/communication_channels/oauth/[provider]/callback',
  // No auth feature gate — the state cookie carries identity. The route still
  // verifies the session below to bind the callback to its initiator.
  GET: { requireAuth: true },
}

type RouteContext = {
  params: Promise<{ provider: string }> | { provider: string }
}

type CredentialsServiceLike = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<Record<string, unknown> | null>
  save?: (
    integrationId: string,
    credentials: Record<string, unknown>,
    scope: { organizationId: string; tenantId: string; userId?: string | null },
  ) => Promise<void>
}

function redirectWithFlash(
  req: Request,
  returnUrl: string,
  flash: { type: 'connected' | 'error'; code?: string; provider?: string; channelId?: string },
): Response {
  const base = new URL(
    normalizeOAuthReturnUrl(returnUrl, DEFAULT_OAUTH_RETURN_URL),
    new URL(req.url).origin,
  )
  base.searchParams.set('flash', flash.type)
  if (flash.code) base.searchParams.set('code', flash.code)
  if (flash.provider) base.searchParams.set('provider', flash.provider)
  if (flash.channelId) base.searchParams.set('channelId', flash.channelId)
  const response = NextResponse.redirect(base.toString(), 302)
  response.cookies.set({
    name: COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}

export async function GET(req: Request, context: RouteContext): Promise<Response> {
  const { provider } = await context.params
  const url = new URL(req.url)
  const code = url.searchParams.get('code') ?? ''
  const stateParam = url.searchParams.get('state') ?? ''
  const error = url.searchParams.get('error')

  if (error) {
    return redirectWithFlash(req, DEFAULT_OAUTH_RETURN_URL, { type: 'error', code: error, provider })
  }
  if (!code || !stateParam) {
    return redirectWithFlash(req, DEFAULT_OAUTH_RETURN_URL, {
      type: 'error',
      code: 'missing_code_or_state',
      provider,
    })
  }

  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth?.tenantId) {
    return redirectWithFlash(req, DEFAULT_OAUTH_RETURN_URL, {
      type: 'error',
      code: 'unauthorized',
      provider,
    })
  }

  const adapter = getChannelAdapter(provider)
  if (!adapter || typeof adapter.exchangeOAuthCode !== 'function') {
    return redirectWithFlash(req, DEFAULT_OAUTH_RETURN_URL, {
      type: 'error',
      code: 'unknown_provider',
      provider,
    })
  }

  const cookieValue = req.headers.get('cookie') ?? ''
  const stateCookie = parseCookie(cookieValue, COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME)

  let statePayload
  try {
    statePayload = verifyOAuthState({
      cookie: stateCookie,
      expectedUserId: auth.sub as string,
      expectedProviderKey: provider,
      expectedState: stateParam,
    })
  } catch (err) {
    const errCode = err instanceof OAuthStateError ? err.code : 'invalid_state'
    return redirectWithFlash(req, DEFAULT_OAUTH_RETURN_URL, {
      type: 'error',
      code: errCode,
      provider,
    })
  }

  // Defense-in-depth: the signed state is minted for a specific tenant at
  // initiate time and `verifyOAuthState` already binds it to `auth.sub`. Assert
  // the session tenant matches too, so a token/session anomaly can never create
  // a channel under a different tenant than the one that started the flow.
  if (statePayload.tenantId !== auth.tenantId) {
    return redirectWithFlash(req, DEFAULT_OAUTH_RETURN_URL, {
      type: 'error',
      code: 'tenant_mismatch',
      provider,
    })
  }

  const returnUrl = normalizeOAuthReturnUrl(statePayload.returnUrl, DEFAULT_OAUTH_RETURN_URL)

  // Exchange the code via the adapter.
  const container = await createRequestContainer()
  const credentialsService = (() => {
    try {
      return container.resolve('integrationCredentialsService') as CredentialsServiceLike
    } catch {
      return null
    }
  })()
  // Resolve the tenant's OAuth client app config from the `channel_<provider>`
  // integration (userId = null). Same source the `initiate` route uses; a
  // missing row means the provider was never configured, so bounce back with an
  // actionable code rather than attempting an exchange with empty credentials.
  const oauthClientCredentials = await resolveOAuthClientCredentials(credentialsService, provider, {
    tenantId: statePayload.tenantId,
    organizationId: statePayload.organizationId ?? null,
  })
  if (!oauthClientCredentials) {
    return redirectWithFlash(req, returnUrl, {
      type: 'error',
      code: 'oauth_client_not_configured',
      provider,
    })
  }

  // Must byte-for-byte match the redirect_uri sent at authorize time (the
  // `initiate` route), including behind a reverse proxy — derive it from the
  // configured app origin rather than the raw request URL.
  const redirectUri = toAbsoluteUrl(req, `/api/communication_channels/oauth/${provider}/callback`)

  let exchange
  try {
    exchange = await adapter.exchangeOAuthCode({
      code,
      redirectUri,
      credentials: oauthClientCredentials,
      scope: {
        tenantId: statePayload.tenantId,
        organizationId: statePayload.organizationId ?? statePayload.tenantId,
      },
      stateExtra: statePayload.extra,
    })
  } catch (err) {
    logger.warn(
      'code exchange failed for provider',
      { provider, err },
    )
    return redirectWithFlash(req, returnUrl, {
      type: 'error',
      code: 'exchange_failed',
      provider,
    })
  }

  // Persist the encrypted credentials under a per-user `integration_credentials`
  // row, then create / update the per-user `CommunicationChannel`.
  const em = (container.resolve('em') as EntityManager).fork()
  // Per-user scope: pass `userId` so the credentials service writes to a
  // user-scoped row instead of overwriting the tenant-wide row. Without this,
  // two users on the same tenant share one credentials row (see review R2-C1
  // / N1, 2026-05-26).
  const credentialsScope = {
    tenantId: statePayload.tenantId,
    organizationId: statePayload.organizationId ?? statePayload.tenantId,
    userId: auth.sub as string,
  }
  let credentialsRefId: string | null = null
  let credentialsPersisted = false
  if (credentialsService?.save) {
    try {
      // Save under a per-provider integration id namespace; per-user scoping is
      // recorded on `IntegrationCredentials.user_id` via the `scope.userId`.
      // Arg order MUST be (integrationId, credentials, scope) — matches the real
      // CredentialsService signature; the legacy reversed order corrupted the
      // saved row by writing the scope object into the credentials field.
      await credentialsService.save(
        `channel_${provider}`,
        {
          ...exchange.credentials,
          userId: auth.sub,
          expiresAt: exchange.expiresAt ? exchange.expiresAt.toISOString() : undefined,
        },
        credentialsScope,
      )
      credentialsPersisted = true
    } catch (err) {
      logger.warn(
        'persisting credentials failed for provider',
        { provider, err },
      )
    }
  }
  // Resolve the saved row's id so we can link `channel.credentialsRef` to it.
  // `credentialsService.save` is `void`-returning by contract, so we re-find the
  // row immediately afterwards. Best-effort — null is acceptable; the channel
  // creation below will downgrade to `requires_reauth` so workers don't poll
  // a credential-less channel.
  if (credentialsPersisted) {
    try {
      const { IntegrationCredentials } = await import('@open-mercato/core/modules/integrations/data/entities')
      const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
      const row = await findOneWithDecryption(
        em,
        IntegrationCredentials,
        {
          integrationId: `channel_${provider}`,
          tenantId: credentialsScope.tenantId,
          organizationId: credentialsScope.organizationId,
          userId: credentialsScope.userId,
          deletedAt: null,
        },
        undefined,
        credentialsScope,
      )
      credentialsRefId = (row as { id?: string } | null)?.id ?? null
    } catch {
      credentialsRefId = null
    }
  }

  const displayName =
    exchange.displayName ?? exchange.externalIdentifier ?? `${provider} channel`
  // Fail-safe: if credentials persistence failed (no `credentialsRef` available),
  // create the channel in `requires_reauth` so workers don't poll a channel that
  // has no usable credentials. The user can re-run the OAuth flow to recover
  // (see review R2-H4 / F6, 2026-05-26).
  const credentialsAvailable = credentialsRefId !== null
  let channel
  try {
    channel = await createConnectedChannelRow({
      em,
      adapter,
      providerKey: provider,
      displayName,
      externalIdentifier: exchange.externalIdentifier ?? null,
      credentialsRefId,
      userId: auth.sub as string,
      scope: { tenantId: statePayload.tenantId, organizationId: statePayload.organizationId ?? null },
    })
  } catch (err) {
    // Same mailbox already connected via another provider — don't create a second
    // channel that double-ingests every message; send the user back with a flash.
    if (err instanceof MailboxAlreadyConnectedError) {
      logger.warn('mailbox already connected via another provider', { existingProviderKey: err.existingProviderKey })
      return redirectWithFlash(req, returnUrl, {
        type: 'error',
        code: 'mailbox_already_connected',
        provider,
      })
    }
    throw err
  }

  // Spec C § Phase C5 — best-effort push registration for OAuth providers
  // that support it (Gmail). Same shape as the credential-connect
  // path: failures persist as `pushStatus='failed'` on channelState and DO
  // NOT fail the connect — polling fallback covers until the operator clicks
  // "Re-register push" on the channels page.
  const adapterSupportsPush =
    typeof adapter.registerPush === 'function' && typeof adapter.unregisterPush === 'function'
  if (
    credentialsAvailable &&
    adapterSupportsPush &&
    statePayload.organizationId &&
    provider === 'gmail'
  ) {
    try {
      const { pushRegister } = await import('../../../../../commands/push-register')
      await pushRegister({
        container,
        scope: {
          tenantId: statePayload.tenantId,
          organizationId: statePayload.organizationId,
          userId: auth.sub as string,
        },
        input: { channelId: channel.id },
      })
    } catch (err) {
      logger.warn(
        'best-effort pushRegister failed for channel',
        { channelId: channel.id, err },
      )
    }
  }

  return redirectWithFlash(req, returnUrl, {
    type: 'connected',
    provider,
    channelId: channel.id,
  })
}

function parseCookie(header: string, name: string): string | null {
  if (!header) return null
  const segments = header.split(';')
  for (const segment of segments) {
    const trimmed = segment.trim()
    if (trimmed.startsWith(`${name}=`)) {
      return decodeURIComponent(trimmed.slice(name.length + 1))
    }
  }
  return null
}

export const openApi = {
  tags: ['CommunicationChannels'],
  methods: {
    GET: {
      summary: 'OAuth callback — exchange code, persist credentials, create per-user channel',
      tags: ['CommunicationChannels'],
      responses: [
        { status: 302, description: 'Redirect back to returnUrl with flash query params' },
      ],
    },
  },
}
export default GET
