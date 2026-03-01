import type { SsoConfig } from '../data/entities'

export interface SsoProtocolProvider {
  readonly protocol: 'oidc' | 'saml'

  buildAuthUrl(
    config: SsoConfig,
    params: {
      state: string
      nonce: string
      redirectUri: string
      codeVerifier?: string
      clientSecret?: string
    },
  ): Promise<string>

  handleCallback(
    config: SsoConfig,
    params: {
      callbackParams: Record<string, string>
      redirectUri: string
      expectedState: string
      expectedNonce: string
      codeVerifier?: string
      clientSecret?: string
    },
  ): Promise<SsoIdentityPayload>

  validateConfig(
    config: SsoConfig,
    params?: { clientSecret?: string },
  ): Promise<{ ok: boolean; error?: string }>
}

export interface SsoIdentityPayload {
  subject: string
  email: string
  emailVerified: boolean
  name?: string
  groups?: string[]
}

export interface SsoFlowState {
  state: string
  nonce: string
  codeVerifier: string
  configId: string
  returnUrl: string
  expiresAt: number
}
