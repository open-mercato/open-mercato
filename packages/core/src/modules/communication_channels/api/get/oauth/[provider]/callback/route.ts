import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CommunicationChannel } from '../../../../../data/entities'
import { getChannelAdapter } from '../../../../../lib/adapter-registry-singleton'
import {
  COMMUNICATION_CHANNELS_OAUTH_STATE_COOKIE_NAME,
  DEFAULT_OAUTH_RETURN_URL,
  normalizeOAuthReturnUrl,
  OAuthStateError,
  verifyOAuthState,
} from '../../../../../lib/oauth-state'

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
  let oauthClientCredentials: Record<string, unknown> = {}
  if (credentialsService) {
    try {
      oauthClientCredentials =
        (await credentialsService.resolve(`oauth_${provider}`, {
          tenantId: statePayload.tenantId,
          organizationId: statePayload.organizationId ?? statePayload.tenantId,
        })) ?? {}
    } catch {
      oauthClientCredentials = {}
    }
  }

  const redirectUri = (() => {
    const u = new URL(req.url)
    u.search = ''
    return u.toString()
  })()

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
    console.warn(
      `[communication_channels:oauth] code exchange failed for provider ${provider}:`,
      err instanceof Error ? err.message : err,
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
      console.warn(
        `[communication_channels:oauth] persisting credentials failed for provider ${provider}:`,
        err instanceof Error ? err.message : err,
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
        IntegrationCredentials as any,
        {
          integrationId: `channel_${provider}`,
          tenantId: credentialsScope.tenantId,
          organizationId: credentialsScope.organizationId,
          userId: credentialsScope.userId,
          deletedAt: null,
        } as any,
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
  const channel = em.create(CommunicationChannel, {
    providerKey: provider,
    channelType: adapter.channelType,
    displayName,
    externalIdentifier: exchange.externalIdentifier ?? null,
    credentialsRef: credentialsRefId,
    capabilities: adapter.capabilities as unknown as Record<string, unknown>,
    isActive: credentialsAvailable,
    userId: auth.sub as string,
    isPrimary: false,
    pollIntervalSeconds: adapter.capabilities?.realtimePush === false ? 300 : null,
    status: credentialsAvailable ? 'connected' : 'requires_reauth',
    lastError: credentialsAvailable ? null : 'credentials_persist_failed',
    tenantId: statePayload.tenantId,
    organizationId: statePayload.organizationId ?? null,
  } as any)
  em.persist(channel)
  await em.flush()

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
