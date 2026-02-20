import * as client from 'openid-client'
import type { SsoConfig } from '../data/entities'
import type { SsoIdentityPayload, SsoProtocolProvider } from './types'

export class OidcProvider implements SsoProtocolProvider {
  readonly protocol = 'oidc' as const

  async buildAuthUrl(
    config: SsoConfig,
    params: {
      state: string
      nonce: string
      redirectUri: string
      codeVerifier?: string
      clientSecret?: string
    },
  ): Promise<string> {
    const oidcConfig = await this.discover(config, params.clientSecret)

    const codeChallenge = params.codeVerifier
      ? await client.calculatePKCECodeChallenge(params.codeVerifier)
      : undefined

    const authUrl = client.buildAuthorizationUrl(oidcConfig, {
      redirect_uri: params.redirectUri,
      scope: 'openid email profile',
      state: params.state,
      nonce: params.nonce,
      ...(codeChallenge
        ? { code_challenge: codeChallenge, code_challenge_method: 'S256' }
        : {}),
    })

    return authUrl.href
  }

  async handleCallback(
    config: SsoConfig,
    params: {
      callbackParams: Record<string, string>
      redirectUri: string
      expectedState: string
      expectedNonce: string
      codeVerifier?: string
      clientSecret?: string
    },
  ): Promise<SsoIdentityPayload> {
    const oidcConfig = await this.discover(config, params.clientSecret)

    const callbackUrl = new URL(params.redirectUri)
    for (const [key, value] of Object.entries(params.callbackParams)) {
      callbackUrl.searchParams.set(key, value)
    }

    const tokens = await client.authorizationCodeGrant(oidcConfig, callbackUrl, {
      pkceCodeVerifier: params.codeVerifier,
      expectedState: params.expectedState,
      expectedNonce: params.expectedNonce,
    })
    console.log("[SSO] ", tokens)
    const claims = tokens.claims()
    if (!claims) {
      throw new Error('No ID token claims received from IdP')
    }

    const mergedClaims = await mergeWithUserInfoClaims(oidcConfig, tokens, claims)

    const subject = String(mergedClaims.sub ?? claims.sub ?? '')
    const email = mergedClaims.email as string | undefined
    if (!email) {
      throw new Error('IdP did not return an email claim')
    }

    const emailVerified = mergedClaims.email_verified === true
    const groups = extractIdentityGroups(mergedClaims)

    if (process.env.SSO_DEBUG_CLAIMS === 'true') {
      console.log('[SSO] OIDC claim keys:', Object.keys(mergedClaims).sort())
      console.log('[SSO] OIDC mapped groups/roles:', groups ?? [])
    }

    return {
      subject,
      email,
      emailVerified,
      name: (mergedClaims.name as string) ?? undefined,
      groups,
    }
  }

  async validateConfig(
    config: SsoConfig,
    params?: { clientSecret?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.discover(config, params?.clientSecret)
      return { ok: true }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Discovery failed',
      }
    }
  }

  private async discover(
    config: SsoConfig,
    clientSecret?: string,
  ): Promise<client.Configuration> {
    if (!config.issuer) {
      throw new Error('SSO config is missing issuer URL')
    }
    if (!config.clientId) {
      throw new Error('SSO config is missing client ID')
    }

    return client.discovery(
      new URL(config.issuer),
      config.clientId,
      clientSecret ?? undefined,
    )
  }
}

async function mergeWithUserInfoClaims(
  oidcConfig: client.Configuration,
  tokens: client.TokenEndpointResponse,
  claims: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const accessToken = tokens.access_token
  if (!accessToken) return claims

  try {
    const userInfo = await client.fetchUserInfo(
      oidcConfig,
      accessToken,
      client.skipSubjectCheck,
    )
    return { ...(userInfo as Record<string, unknown>), ...claims }
  } catch {
    return claims
  }
}

function extractIdentityGroups(claims: Record<string, unknown>): string[] | undefined {
  const groups = new Set<string>()

  const add = (value: unknown) => {
    for (const group of coerceClaimValues(value)) {
      groups.add(group)
    }
  }

  add(claims.groups)
  add(claims.roles)
  add(claims.role)

  for (const [key, value] of Object.entries(claims)) {
    if (!key.endsWith(':roles')) continue
    add(value)
  }

  return groups.size > 0 ? Array.from(groups) : undefined
}

function coerceClaimValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized ? [normalized] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => coerceClaimValues(entry))
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    const out = new Set<string>()
    for (const [key, nested] of entries) {
      const normalizedKey = key.trim()
      if (normalizedKey) out.add(normalizedKey)
      if (typeof nested === 'string') {
        const normalizedNested = nested.trim()
        if (normalizedNested) out.add(normalizedNested)
      } else if (nested && typeof nested === 'object') {
        const nestedName = (nested as Record<string, unknown>).name
        if (typeof nestedName === 'string' && nestedName.trim()) {
          out.add(nestedName.trim())
        }
      }
    }
    return Array.from(out)
  }

  return []
}
