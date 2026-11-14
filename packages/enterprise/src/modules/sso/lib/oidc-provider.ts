import * as client from 'openid-client'
import { createHash } from 'node:crypto'
import type { SsoConfig } from '../data/entities'
import type { SsoIdentityPayload, SsoProtocolProvider } from './types'
import { createOidcFetch } from './oidc-url-safety'
import { SsoAssuranceError } from './errors'

const OIDC_DISCOVERY_TIMEOUT_SECONDS = 10
const OIDC_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000
const OIDC_DISCOVERY_CACHE_MAX_ENTRIES = 100

interface CachedDiscovery {
  expiresAt: number
  promise: Promise<client.Configuration>
}

const sharedDiscoveryCache = new Map<string, CachedDiscovery>()

export class OidcProvider implements SsoProtocolProvider {
  readonly protocol = 'oidc' as const
  private readonly requestDiscoveryCache = new Map<string, CachedDiscovery>()
  private readonly guardedFetch = createOidcFetch()

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
      ...buildOidcAssuranceAuthorizationParameters(config),
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

    const claims = tokens.claims()
    if (!claims) {
      throw new Error('No ID token claims received from IdP')
    }

    const mergedClaims = await mergeWithUserInfoClaims(oidcConfig, tokens, claims)

    const subject = String(mergedClaims.sub ?? claims.sub ?? '')
    const rawEmail = mergedClaims.email as string | undefined
    const upnCandidate = (mergedClaims.upn ?? mergedClaims.unique_name) as string | undefined
    const upnAsEmail = typeof upnCandidate === 'string' && upnCandidate.includes('@') ? upnCandidate : undefined
    const email = rawEmail ?? upnAsEmail
    if (!email) {
      throw new Error('IdP did not return an email claim (checked: email, upn, unique_name)')
    }

    const emailVerified = normalizeEmailVerifiedClaim(mergedClaims.email_verified)
    const groups = extractIdentityGroups(mergedClaims)
    const acr = normalizeAcrClaim(mergedClaims.acr)
    const amr = normalizeAmrClaim(mergedClaims.amr)

    assertOidcAssurance(config, { acr, amr })

    return {
      subject,
      email,
      ...(emailVerified === undefined ? {} : { emailVerified }),
      name: (mergedClaims.name as string) ?? undefined,
      groups,
      acr,
      amr,
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

    const clientSecretFingerprint = createHash('sha256')
      .update(clientSecret ?? '')
      .digest('base64url')
    const cacheKey = `${config.id}:${config.updatedAt.getTime()}:${clientSecretFingerprint}`
    const now = Date.now()
    const cached =
      this.requestDiscoveryCache.get(cacheKey) ?? sharedDiscoveryCache.get(cacheKey)
    if (cached && cached.expiresAt > now) return cached.promise

    for (const [key, entry] of sharedDiscoveryCache) {
      if (entry.expiresAt <= now) sharedDiscoveryCache.delete(key)
    }
    if (sharedDiscoveryCache.size >= OIDC_DISCOVERY_CACHE_MAX_ENTRIES) {
      const oldestKey = sharedDiscoveryCache.keys().next().value
      if (oldestKey) sharedDiscoveryCache.delete(oldestKey)
    }

    const promise = client.discovery(
      new URL(config.issuer),
      config.clientId,
      clientSecret ?? undefined,
      undefined,
      {
        [client.customFetch]: this.guardedFetch,
        timeout: OIDC_DISCOVERY_TIMEOUT_SECONDS,
      },
    )
    const entry = {
      expiresAt: now + OIDC_DISCOVERY_CACHE_TTL_MS,
      promise,
    }
    this.requestDiscoveryCache.set(cacheKey, entry)
    sharedDiscoveryCache.set(cacheKey, entry)
    void promise
      .then((configuration) => {
        if (
          typeof configuration.serverMetadata !== 'function' &&
          sharedDiscoveryCache.get(cacheKey)?.promise === promise
        ) {
          sharedDiscoveryCache.delete(cacheKey)
        }
      })
      .catch(() => {
        if (this.requestDiscoveryCache.get(cacheKey)?.promise === promise) {
          this.requestDiscoveryCache.delete(cacheKey)
        }
        if (sharedDiscoveryCache.get(cacheKey)?.promise === promise) {
          sharedDiscoveryCache.delete(cacheKey)
        }
      })
    return promise
  }
}

export function buildOidcAssuranceAuthorizationParameters(
  config: Pick<SsoConfig, 'requiredAcrValues'>,
): Record<string, string> {
  if (config.requiredAcrValues.length === 0) return {}

  return {
    claims: JSON.stringify({
      id_token: {
        acr: {
          essential: true,
          values: config.requiredAcrValues,
        },
      },
    }),
  }
}

export function assertOidcAssurance(
  config: Pick<SsoConfig, 'requiredAcrValues' | 'requiredAmrValues'>,
  assurance: Pick<SsoIdentityPayload, 'acr' | 'amr'>,
): void {
  if (
    config.requiredAcrValues.length > 0
    && (!assurance.acr || !config.requiredAcrValues.includes(assurance.acr))
  ) {
    throw new SsoAssuranceError('The identity provider did not satisfy the required authentication context')
  }

  const actualAmr = new Set(assurance.amr ?? [])
  if (
    config.requiredAmrValues.length > 0
    && !config.requiredAmrValues.every((value) => actualAmr.has(value))
  ) {
    throw new SsoAssuranceError('The identity provider did not satisfy the required authentication methods')
  }
}

export function normalizeAcrClaim(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

export function normalizeAmrClaim(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const normalized = Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean),
  ))
  return normalized.length > 0 ? normalized : undefined
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

export function normalizeEmailVerifiedClaim(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function extractIdentityGroups(claims: Record<string, unknown>): string[] | undefined {
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

export function coerceClaimValues(value: unknown): string[] {
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
