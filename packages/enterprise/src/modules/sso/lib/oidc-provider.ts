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

    const claims = tokens.claims()
    if (!claims) {
      throw new Error('No ID token claims received from IdP')
    }

    const subject = claims.sub
    const email = claims.email as string | undefined
    if (!email) {
      throw new Error('IdP did not return an email claim')
    }

    const emailVerified = claims.email_verified === true

    return {
      subject,
      email,
      emailVerified,
      name: (claims.name as string) ?? undefined,
      groups: Array.isArray(claims.groups) ? (claims.groups as string[]) : undefined,
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
